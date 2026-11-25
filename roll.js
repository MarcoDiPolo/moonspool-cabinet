(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.MoonRoll = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  var NOTES       = Object.freeze([57, 60, 62, 64, 67]);
  var STEPS       = 16;
  var STEP_TICKS  = 24;
  var PPQ         = 96;
  var TOTAL_TICKS = 384;
  var NOTE_ON     = 0x90;
  var NOTE_OFF    = 0x80;
  var VELOCITY    = 80;
  var NOTE_SUSTAIN = 20;
  var BPM_MIN     = 60;
  var BPM_MAX     = 150;
  var TOKEN_VERSION = 1;
  var TOKEN_LENGTH  = 24;   // 18 bytes → 24 base64url characters
  var PAYLOAD_BYTES = 18;   // 1 version + 1 tempo-offset + 16 masks

  // ─── Presets ─────────────────────────────────────────────────────────────────

  // Moonrise — a brooding ascending phrase that opens like a slow tide.
  var PRESET_MOONRISE = Object.freeze(
    [1, 0, 2, 0, 4, 0, 5, 0, 8, 0, 9, 0, 16, 0, 17, 0]
  );

  // Widdershins — a counter-clockwise ritual figure, syncopated and descending.
  var PRESET_WIDDERSHINS = Object.freeze(
    [16, 0, 24, 0, 8, 4, 0, 20, 0, 9, 0, 6, 0, 18, 0, 17]
  );

  // ─── Input guards ─────────────────────────────────────────────────────────────

  // Accepts only a safe integer with no fractional part within [lo, hi].
  function requireInt(value, lo, hi, name) {
    if (typeof value !== 'number' ||
        !isFinite(value) ||
        value !== Math.floor(value) ||
        value < lo ||
        value > hi ||
        Math.abs(value) > 0x1fffff_ffff_ffff) { // beyond safe integer range
      throw new RangeError(name + ' must be an integer ' + lo + '\u2013' + hi);
    }
  }

  // Accepts only a dense Array of exactly `length` elements.
  function requireDenseArray(value, length, name) {
    if (!Array.isArray(value) || value.length !== length) {
      throw new RangeError(name + ' must be an array of ' + length + ' masks');
    }
    // Reject sparse arrays: every index must be an own property.
    for (var i = 0; i < length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new RangeError(name + ' must not be sparse (missing index ' + i + ')');
      }
    }
  }

  // Validates and returns every mask in a pattern array.
  function requireMasks(pattern) {
    for (var i = 0; i < STEPS; i++) {
      var m = pattern[i];
      requireInt(m, 0, 31, 'mask at step ' + i);
    }
  }

  // ─── Roll helpers ─────────────────────────────────────────────────────────────

  function emptyRoll() {
    return new Array(STEPS).fill(0);
  }

  function toggle(pattern, step, noteIndex) {
    requireDenseArray(pattern, STEPS, 'pattern');
    requireMasks(pattern);
    requireInt(step,      0, STEPS - 1,       'step');
    requireInt(noteIndex, 0, NOTES.length - 1, 'noteIndex');
    var copy = pattern.slice();
    copy[step] = (copy[step] ^ (1 << noteIndex)) & 31;
    return copy;
  }

  // ─── URL token encoding / decoding ───────────────────────────────────────────

  // RFC 4648 §5 base64url alphabet — exactly 64 ASCII characters.
  var B64_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // Reverse lookup table: charCode → 6-bit value, -1 for non-members.
  var B64_LOOKUP = (function () {
    var t = new Array(128).fill(-1);
    for (var i = 0; i < B64_CHARS.length; i++) {
      t[B64_CHARS.charCodeAt(i)] = i;
    }
    return t;
  }());

  function b64Encode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64_CHARS[(b0 >> 2) & 63];
      out += B64_CHARS[((b0 & 3) << 4) | ((b1 >> 4) & 15)];
      out += B64_CHARS[((b1 & 15) << 2) | ((b2 >> 6) & 3)];
      out += B64_CHARS[b2 & 63];
    }
    return out;
  }

  // Returns an array of bytes, or null if any character is outside the alphabet.
  // Rejects code points ≥ 128 (non-ASCII) before the lookup, preventing
  // multi-byte Unicode from aliasing to a valid 7-bit index.
  function b64Decode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var c0 = str.charCodeAt(i);
      var c1 = str.charCodeAt(i + 1);
      var c2 = str.charCodeAt(i + 2);
      var c3 = str.charCodeAt(i + 3);
      // Reject any non-ASCII code point immediately.
      if (c0 > 127 || c1 > 127 || c2 > 127 || c3 > 127) return null;
      var v0 = B64_LOOKUP[c0];
      var v1 = B64_LOOKUP[c1];
      var v2 = B64_LOOKUP[c2];
      var v3 = B64_LOOKUP[c3];
      if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return null;
      bytes.push(((v0 << 2) | (v1 >> 4)) & 0xff);
      bytes.push(((v1 << 4) | (v2 >> 2)) & 0xff);
      bytes.push(((v2 << 6) | v3) & 0xff);
    }
    return bytes;
  }

  function encode(pattern, bpm) {
    requireDenseArray(pattern, STEPS, 'pattern');
    requireMasks(pattern);
    requireInt(bpm, BPM_MIN, BPM_MAX, 'bpm');
    var bytes = new Array(PAYLOAD_BYTES);
    bytes[0] = TOKEN_VERSION;
    bytes[1] = bpm - BPM_MIN;
    for (var i = 0; i < STEPS; i++) {
      bytes[2 + i] = pattern[i];
    }
    return b64Encode(bytes);
  }

  function decode(token) {
    try {
      if (typeof token !== 'string') return null;
      // Enforce exact ASCII length before any further work.
      if (token.length !== TOKEN_LENGTH) return null;
      // All characters must be printable ASCII (< 128); b64Decode checks further.
      for (var ci = 0; ci < TOKEN_LENGTH; ci++) {
        if (token.charCodeAt(ci) > 127) return null;
      }
      var bytes = b64Decode(token);
      if (!bytes || bytes.length < PAYLOAD_BYTES) return null;
      if (bytes[0] !== TOKEN_VERSION) return null;
      var bpm = bytes[1] + BPM_MIN;
      if (bpm < BPM_MIN || bpm > BPM_MAX) return null;
      var pattern = [];
      for (var i = 0; i < STEPS; i++) {
        var mask = bytes[2 + i];
        if (mask < 0 || mask > 31) return null;
        pattern.push(mask);
      }
      return { pattern: pattern, bpm: bpm };
    } catch (e) {
      return null;
    }
  }

  // ─── MIDI export ─────────────────────────────────────────────────────────────

  function writeVLQ(arr, value) {
    var buf = [value & 0x7f];
    value >>>= 7;
    while (value > 0) {
      buf.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    for (var i = buf.length - 1; i >= 0; i--) arr.push(buf[i]);
  }

  function midi(pattern, bpm) {
    requireDenseArray(pattern, STEPS, 'pattern');
    requireMasks(pattern);
    requireInt(bpm, BPM_MIN, BPM_MAX, 'bpm');

    var usPerBeat = Math.round(60000000 / bpm);
    var events = [];
    events.push({ tick: 0, type: 'tempo', value: usPerBeat });

    for (var step = 0; step < STEPS; step++) {
      var mask     = pattern[step];
      var stepTick = step * STEP_TICKS;
      for (var row = 0; row < NOTES.length; row++) {
        if (mask & (1 << row)) {
          var offTick = stepTick + NOTE_SUSTAIN;
          if (offTick > TOTAL_TICKS - 1) offTick = TOTAL_TICKS - 1;
          events.push({ tick: stepTick, type: 'on',  pitch: NOTES[row] });
          events.push({ tick: offTick,  type: 'off', pitch: NOTES[row] });
        }
      }
    }
    events.push({ tick: TOTAL_TICKS, type: 'eot' });

    var typeOrder = { tempo: 0, off: 1, on: 2, eot: 3 };
    events.sort(function (a, b) {
      return a.tick !== b.tick
        ? a.tick - b.tick
        : (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0);
    });

    var track  = [];
    var cursor = 0;
    for (var ei = 0; ei < events.length; ei++) {
      var ev    = events[ei];
      var delta = ev.tick - cursor;
      cursor = ev.tick;
      writeVLQ(track, delta);
      if (ev.type === 'tempo') {
        var us = ev.value;
        track.push(0xff, 0x51, 0x03,
          (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
      } else if (ev.type === 'on') {
        track.push(NOTE_ON, ev.pitch & 0x7f, VELOCITY & 0x7f);
      } else if (ev.type === 'off') {
        track.push(NOTE_OFF, ev.pitch & 0x7f, 0x00);
      } else if (ev.type === 'eot') {
        track.push(0xff, 0x2f, 0x00);
      }
    }

    var tl   = track.length;
    var file = [];
    // MThd
    file.push(0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06);
    file.push(0x00, 0x00);                          // format 0
    file.push(0x00, 0x01);                          // 1 track
    file.push((PPQ >> 8) & 0xff, PPQ & 0xff);       // PPQ = 96
    // MTrk
    file.push(0x4d, 0x54, 0x72, 0x6b);
    file.push((tl >> 24) & 0xff, (tl >> 16) & 0xff, (tl >> 8) & 0xff, tl & 0xff);
    for (var ti = 0; ti < tl; ti++) file.push(track[ti]);

    return new Uint8Array(file);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return Object.freeze({
    notes: NOTES,
    presets: Object.freeze({
      Moonrise:    PRESET_MOONRISE,
      Widdershins: PRESET_WIDDERSHINS,
    }),
    toggle: toggle,
    encode: encode,
    decode: decode,
    midi:   midi,
  });
}));
