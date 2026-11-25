'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const roll = require('../roll.js');

function readTrack(bytes) {
  const data = Buffer.from(bytes);
  assert.equal(data.toString('ascii', 0, 4), 'MThd');
  assert.equal(data.readUInt32BE(4), 6);
  assert.equal(data.readUInt16BE(8), 0);
  assert.equal(data.readUInt16BE(10), 1);
  assert.equal(data.readUInt16BE(12), 96);
  assert.equal(data.toString('ascii', 14, 18), 'MTrk');
  assert.equal(data.readUInt32BE(18), data.length - 22);
  let p = 22, tick = 0, lastStatus = null, micros = null, end = null;
  const notes = [];
  function byte() { assert.ok(p < data.length, 'truncated event'); return data[p++]; }
  function vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = byte();
      n = n * 128 + (b & 127);
      if (b < 128) return n;
    }
    throw Error('invalid MIDI variable-length quantity');
  }
  while (p < data.length) {
    tick += vlq();
    let status = data[p];
    if (status >= 128) { byte(); lastStatus = status; } else { status = lastStatus; }
    assert.ok(status >= 128, 'missing status');
    if (status === 0xff) {
      const type = byte(), length = vlq();
      assert.ok(p + length <= data.length);
      if (type === 0x51) { assert.equal(length, 3); micros = data.readUIntBE(p, 3); }
      if (type === 0x2f) { assert.equal(length, 0); end = tick; assert.equal(p, data.length); }
      p += length; lastStatus = null;
    } else {
      const family = status >> 4;
      assert.ok(family >= 8 && family <= 14);
      const a = byte(), b = (family === 12 || family === 13) ? null : byte();
      assert.ok(a < 128 && (b === null || b < 128));
      if (family === 8 || family === 9) notes.push({ tick, note: a, on: family === 9 && b !== 0 });
    }
  }
  return { notes, micros, end };
}

test('station spans the five advertised pitches; both example rolls are distinct', () => {
  assert.deepEqual(Array.from(roll.notes), [57, 60, 62, 64, 67]);
  assert.notDeepEqual(roll.presets.Moonrise, roll.presets.Widdershins);
  for (const p of Object.values(roll.presets)) {
    assert.equal(p.length, 16);
    assert.ok(Array.from(p).some(x => x !== 0));
    assert.ok(Array.from(p).every(x => Number.isInteger(x) && x >= 0 && x < 32));
  }
});

test('changing a hole twice restores the exact original without modifying it', () => {
  const p = Array(16).fill(0);
  for (let s = 0; s < 16; s++) for (let row = 0; row < 5; row++) {
    const edit = roll.toggle(p, s, row);
    assert.equal(edit[s], 1 << row);
    assert.equal(p[s], 0);
    assert.deepEqual(Array.from(roll.toggle(edit, s, row)), p);
  }
});

test('1,024 generated rolls survive the shared-link format, including the end tempos', () => {
  let state = 0x2c17b8e;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 1024; i++) {
    const p = Array.from({length: 16}, () => (next() >>> 16) & 31);
    const bpm = 60 + i % 91;
    const token = roll.encode(p, bpm);
    assert.match(token, /^[A-Za-z0-9._~-]+$/);
    const parsed = roll.decode(token);
    assert.deepEqual(Array.from(parsed.pattern), p); assert.equal(parsed.bpm, bpm);
  }
  for (const broken of ['', '#', 'not-a-roll', '%00', null, '{}']) assert.equal(roll.decode(broken), null);
});

test('MIDI preserves chords, tempo, final rests and repeated notes through an independent reader', () => {
  const rolls = [Array(16).fill(0), Array(16).fill(31), ...Object.values(roll.presets)];
  for (let i = 0; i < 64; i++) rolls.push(Array.from({length: 16}, (_, s) => (i * 7 + s * 11) % 32));
  for (const bpm of [60, 91, 120, 150]) for (const p of rolls) {
    const f = readTrack(roll.midi(p, bpm));
    assert.equal(f.end, 384); assert.ok(Math.abs(f.micros - 60000000 / bpm) <= 1);
    const expected = [], found = [], active = new Map();
    for (let s=0; s<16; s++) for (let r=0;r<5;r++) if(p[s] & (1<<r)) expected.push([24*s,roll.notes[r]]);
    for (const evt of f.notes) {
      if (evt.on) {
        assert.ok(!active.has(evt.note), 'note was still sounding on the next hit');
        active.set(evt.note,evt.tick); found.push([evt.tick,evt.note]);
      } else {
        assert.ok(active.has(evt.note), 'note-off without corresponding note');
        const start = active.get(evt.note);
        assert.ok(evt.tick > start && evt.tick <= start + 24);
        active.delete(evt.note);
      }
    }
    assert.equal(active.size, 0);
    const order=(a,b) => a[0]-b[0] || a[1]-b[1];
    assert.deepEqual(found.sort(order),expected);
  }
});
