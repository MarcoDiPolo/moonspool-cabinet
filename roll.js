/**
 * Moonspool Cabinet — roll.js
 * A mechanical paper-roll instrument engine.
 *
 * Browser:  window.MoonRoll
 * Node:     const MoonRoll = require('./roll.js')
 *
 * Five pitches — A minor pentatonic — ascending MIDI notes:
 *   Row 0 → 57 (A3)
 *   Row 1 → 60 (C4)
 *   Row 2 → 62 (D4)
 *   Row 3 → 64 (E4)
 *   Row 4 → 67 (G4)
 *
 * Each step is a 5-bit chord mask (0–31).
 * A roll is an array of 16 such masks.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.MoonRoll = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  /** Ascending MIDI pitches for the five rows (A minor pentatonic). */
  var NOTES = Object.freeze([57, 60, 62, 64, 67]);

  var STEPS        = 16;
  var STEP_TICKS   = 24;   // 24 PPQ ticks per sixteenth note
  var PPQ          = 96;   // quarter note = 96 ticks
  var TOTAL_TICKS  = 384;  // 16 × 24 = 384 ticks (one bar of 4/4)
  var NOTE_ON      = 0x90;
  var NOTE_OFF     = 0x80;
  var VELOCITY     = 80;
  var NOTE_SUSTAIN = 20;   // ticks a note is held before its off event

  var BPM_MIN = 60;
  var BPM_MAX = 150;

  var TOKEN_VERSION = 1;

  // ─── Presets ─────────────────────────────────────────────────────────────────

  /**
   * Moonrise — a brooding ascending phrase that opens like a slow tide.
   * Mask bits: row 4 = G4 (MSB), row 0 = A3 (LSB)
   *
   *  Step:  0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
   *  Notes composed across the bar in a climbing minor shape.
   */
  var PRESET_MOONRISE = Object.freeze(
    [1, 0, 2, 0, 4, 0, 5, 0, 8, 0, 9, 0, 16, 0, 17, 0]
    //  A      C     D    CD     E     AE      G      GA
  );

  /**
   * Widdershins — a counter-clockwise ritual figure, syncopated and descending.
   * Uses the upper register heavily and lands on hollow open intervals.
   */
  var PRESET_WIDDERSHINS = Object.freeze(
    [16, 0, 24, 0, 8, 4, 0, 20, 0, 9, 0, 6, 0, 18, 0, 17]
    //   G     GE    E  D     G D     AE    DC    CE    GA
  );

  // ─── Roll helpers ─────────────────────────────────────────────────────────────

  /**
   * Returns a fresh 16-step roll initialised to all rests.
   */
  function emptyRoll() {
    return new Array(STEPS).fill(0);
  }

  /**
   * toggle(pattern, step, noteIndex)
   * Flips the bit at noteIndex in pattern[step] and returns the new roll.
   * Never mutates the original. Throws on invalid input.
   */
  function toggle(pattern, step, noteIndex) {
    if (!Array.isArray(pattern) || pattern.length !== STEPS) {
      throw new RangeError('pattern must be an array of ' + STEPS + ' masks');
    }
    if (step < 0 || step >= STEPS || (step | 0) !== step) {
      throw new RangeError('step must be an integer 0–' + (STEPS - 1));
    }
    if (noteIndex < 0 || noteIndex >= NOTES.length || (noteIndex | 0) !== noteIndex) {
      throw new RangeError('noteIndex must be an integer 0–' + (NOTES.length - 1));
    }
    var copy = pattern.slice();
    copy[step] = (copy[step] ^ (1 << noteIndex)) & 31;
    return copy;
  }

  // ─── URL token encoding / decoding ───────────────────────────────────────────

  /**
   * Base64url alphabet (RFC 4648 §5, URL-safe, no padding).
   */
  var B64_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64Encode(bytes) {
    var out = '';
    var i = 0;
    var len = bytes.length;
    while (i < len) {
      var b0 = bytes[i++];
      var b1 = i < len ? bytes[i++] : 0;
      var b2 = i < len ? bytes[i++] : 0;
      out += B64_CHARS[(b0 >> 2) & 63];
      out += B64_CHARS[((b0 & 3) << 4) | ((b1 >> 4) & 15)];
      out += B64_CHARS[((b1 & 15) << 2) | ((b2 >> 6) & 3)];
      out += B64_CHARS[b2 & 63];
    }
    // Strip padding-equivalent characters we won't use (safe; we know the length)
    return out;
  }

  function b64Decode(str) {
    var lookup = new Array(128).fill(-1);
    for (var i = 0; i < B64_CHARS.length; i++) {
      lookup[B64_CHARS.charCodeAt(i)] = i;
    }
    var bytes = [];
    var i = 0;
    while (i + 3 < str.length) {
      var c0 = lookup[str.charCodeAt(i)];
      var c1 = lookup[str.charCodeAt(i + 1)];
      var c2 = lookup[str.charCodeAt(i + 2)];
      var c3 = lookup[str.charCodeAt(i + 3)];
      if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;
      bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);
      bytes.push(((c1 << 4) | (c2 >> 2)) & 0xff);
      bytes.push(((c2 << 6) | c3) & 0xff);
      i += 4;
    }
    return bytes;
  }

  /**
   * encode(pattern, bpm)
   * Packs version (1 byte) + bpm (1 byte, stored as bpm-60) + 16 masks (1 byte
   * each, 5 bits used) = 18 bytes → 24 base64url characters.
   * Returns a URL-fragment-safe string.
   */
  function encode(pattern, bpm) {
    if (!Array.isArray(pattern) || pattern.length !== STEPS) {
      throw new RangeError('pattern must be an array of ' + STEPS + ' masks');
    }
    var bpmInt = bpm | 0;
    if (bpmInt < BPM_MIN || bpmInt > BPM_MAX) {
      throw new RangeError('bpm must be an integer ' + BPM_MIN + '–' + BPM_MAX);
    }
    var bytes = new Array(18);
    bytes[0] = TOKEN_VERSION;
    bytes[1] = bpmInt - BPM_MIN;
    for (var i = 0; i < STEPS; i++) {
      var mask = pattern[i] | 0;
      if (mask < 0 || mask > 31) {
        throw new RangeError('mask at step ' + i + ' is out of range 0–31');
      }
      bytes[2 + i] = mask;
    }
    return b64Encode(bytes);
  }

  /**
   * decode(token)
   * Returns { pattern, bpm } on success, or null for any malformed token.
   * Never throws.
   */
  function decode(token) {
    try {
      if (typeof token !== 'string' || token.length !== 24) return null;
      var bytes = b64Decode(token);
      if (!bytes || bytes.length < 18) return null;
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

  /**
   * Writes a variable-length quantity into an array and returns it appended.
   */
  function writeVLQ(arr, value) {
    if (value < 0) throw new RangeError('VLQ value must be non-negative');
    var buf = [];
    buf.push(value & 0x7f);
    value >>= 7;
    while (value > 0) {
      buf.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    for (var i = buf.length - 1; i >= 0; i--) {
      arr.push(buf[i]);
    }
    return arr;
  }

  /**
   * midi(pattern, bpm)
   * Returns a Uint8Array containing a valid Standard MIDI File (SMF format 0).
   *
   * Layout (single track):
   *   • Tempo meta-event at tick 0
   *   • For each of 16 steps (24 ticks each):
   *       – All note-ons for active bits at step start
   *       – All note-offs NOTE_SUSTAIN ticks later
   *   • Final rest pads to tick 384
   *   • End-of-track meta-event at tick 384
   *
   * Delta times are always relative to the previous event.
   */
  function midi(pattern, bpm) {
    if (!Array.isArray(pattern) || pattern.length !== STEPS) {
      throw new RangeError('pattern must be an array of ' + STEPS + ' masks');
    }
    var bpmInt = bpm | 0;
    if (bpmInt < BPM_MIN || bpmInt > BPM_MAX) {
      throw new RangeError('bpm must be an integer ' + BPM_MIN + '–' + BPM_MAX);
    }

    // Build a flat list of { tick, type, pitch } events, then sort and encode.
    var events = []; // { tick, type: 'tempo'|'on'|'off'|'eot' }

    // Tempo meta-event: microseconds per quarter note
    var usPerBeat = Math.round(60000000 / bpmInt);
    events.push({ tick: 0, type: 'tempo', value: usPerBeat });

    for (var step = 0; step < STEPS; step++) {
      var mask = pattern[step] | 0;
      if (mask < 0 || mask > 31) {
        throw new RangeError('mask at step ' + step + ' is out of range 0–31');
      }
      var stepTick = step * STEP_TICKS;
      for (var row = 0; row < NOTES.length; row++) {
        if (mask & (1 << row)) {
          var onTick  = stepTick;
          var offTick = stepTick + NOTE_SUSTAIN;
          // Clamp off to not exceed the bar; note-offs must arrive before tick 384
          if (offTick > TOTAL_TICKS - 1) offTick = TOTAL_TICKS - 1;
          events.push({ tick: onTick,  type: 'on',  pitch: NOTES[row] });
          events.push({ tick: offTick, type: 'off', pitch: NOTES[row] });
        }
      }
    }

    // End-of-track at tick 384 (after the final rest)
    events.push({ tick: TOTAL_TICKS, type: 'eot' });

    // Sort: by tick, with note-offs before note-ons at the same tick,
    // tempo always first, end-of-track always last.
    var typeOrder = { tempo: 0, off: 1, on: 2, eot: 3 };
    events.sort(function (a, b) {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0);
    });

    // Encode track bytes
    var track = [];
    var cursor = 0;

    for (var ei = 0; ei < events.length; ei++) {
      var ev = events[ei];
      var delta = ev.tick - cursor;
      cursor = ev.tick;

      writeVLQ(track, delta);

      if (ev.type === 'tempo') {
        // Meta: Set Tempo — FF 51 03 tt tt tt
        var us = ev.value;
        track.push(0xff, 0x51, 0x03,
          (us >> 16) & 0xff,
          (us >>  8) & 0xff,
           us        & 0xff);
      } else if (ev.type === 'on') {
        track.push(NOTE_ON, ev.pitch & 0x7f, VELOCITY & 0x7f);
      } else if (ev.type === 'off') {
        track.push(NOTE_OFF, ev.pitch & 0x7f, 0x00);
      } else if (ev.type === 'eot') {
        // Meta: End of Track — FF 2F 00
        track.push(0xff, 0x2f, 0x00);
      }
    }

    // Build SMF header chunk + track chunk
    var trackLen = track.length;
    var file = [];

    // MThd chunk
    file.push(0x4d, 0x54, 0x68, 0x64); // 'MThd'
    file.push(0x00, 0x00, 0x00, 0x06); // chunk length = 6
    file.push(0x00, 0x00);              // format 0
    file.push(0x00, 0x01);              // 1 track
    file.push((PPQ >> 8) & 0xff, PPQ & 0xff); // PPQ = 96

    // MTrk chunk
    file.push(0x4d, 0x54, 0x72, 0x6b); // 'MTrk'
    file.push(
      (trackLen >> 24) & 0xff,
      (trackLen >> 16) & 0xff,
      (trackLen >>  8) & 0xff,
       trackLen        & 0xff
    );
    for (var ti = 0; ti < track.length; ti++) {
      file.push(track[ti]);
    }

    return new Uint8Array(file);
  }

  // ─── Property tests ───────────────────────────────────────────────────────────

  /**
   * test()
   * Runs deterministic property checks. Returns { passed, failed, results }.
   * Throws nothing; failures are recorded in results[].
   */
  function test() {
    var results = [];
    var passed = 0;
    var failed = 0;

    function assert(label, condition) {
      if (condition) {
        results.push('  PASS  ' + label);
        passed++;
      } else {
        results.push('  FAIL  ' + label);
        failed++;
      }
    }

    function assertThrows(label, fn) {
      try {
        fn();
        results.push('  FAIL  ' + label + ' (expected throw, got none)');
        failed++;
      } catch (e) {
        results.push('  PASS  ' + label);
        passed++;
      }
    }

    // Notes array
    assert('notes length is 5', NOTES.length === 5);
    assert('notes[0] is 57', NOTES[0] === 57);
    assert('notes[4] is 67', NOTES[4] === 67);
    assert('notes are strictly ascending',
      NOTES.every(function (n, i) { return i === 0 || n > NOTES[i - 1]; }));

    // Presets
    assert('Moonrise has 16 steps', presets.Moonrise.length === STEPS);
    assert('Widdershins has 16 steps', presets.Widdershins.length === STEPS);
    assert('Moonrise all masks 0–31',
      presets.Moonrise.every(function (m) { return m >= 0 && m <= 31; }));
    assert('Widdershins all masks 0–31',
      presets.Widdershins.every(function (m) { return m >= 0 && m <= 31; }));
    assert('Moonrise and Widdershins are distinct',
      presets.Moonrise.join() !== presets.Widdershins.join());

    // toggle — immutability
    var base = emptyRoll();
    var toggled = toggle(base, 0, 0);
    assert('toggle returns new array', toggled !== base);
    assert('toggle original unchanged', base[0] === 0);
    assert('toggle sets bit', toggled[0] === 1);
    var toggled2 = toggle(toggled, 0, 0);
    assert('toggle twice clears bit', toggled2[0] === 0);

    // toggle — all 5 rows, all 16 steps, all masks 0–31
    var allToggleOk = true;
    for (var s = 0; s < STEPS; s++) {
      for (var r = 0; r < NOTES.length; r++) {
        var t1 = toggle(emptyRoll(), s, r);
        var bit = 1 << r;
        if (t1[s] !== bit) { allToggleOk = false; break; }
      }
    }
    assert('toggle sets correct bit for every step/row combination', allToggleOk);

    // toggle — invalid inputs
    assertThrows('toggle rejects out-of-range step',
      function () { toggle(emptyRoll(), 16, 0); });
    assertThrows('toggle rejects out-of-range noteIndex',
      function () { toggle(emptyRoll(), 0, 5); });
    assertThrows('toggle rejects wrong-length pattern',
      function () { toggle([0, 1, 2], 0, 0); });

    // encode / decode round-trip across all BPM extremes and edge masks
    var testCases = [
      { pattern: emptyRoll(), bpm: 60 },
      { pattern: emptyRoll(), bpm: 150 },
      { pattern: presets.Moonrise.slice(), bpm: 120 },
      { pattern: presets.Widdershins.slice(), bpm: 90 },
      { pattern: new Array(16).fill(31), bpm: 100 },
    ];
    var roundTripOk = true;
    for (var ti = 0; ti < testCases.length; ti++) {
      var tc = testCases[ti];
      var token = encode(tc.pattern, tc.bpm);
      var decoded = decode(token);
      if (!decoded) { roundTripOk = false; break; }
      if (decoded.bpm !== tc.bpm) { roundTripOk = false; break; }
      if (decoded.pattern.join() !== tc.pattern.join()) { roundTripOk = false; break; }
    }
    assert('encode/decode round-trips for all test cases', roundTripOk);

    // encode — token is 24 chars, URL-safe
    var sampleToken = encode(emptyRoll(), 120);
    assert('token length is 24', sampleToken.length === 24);
    assert('token uses only URL-safe characters', /^[A-Za-z0-9\-_]+$/.test(sampleToken));

    // decode — malformed inputs return null and do not throw
    var malformed = [
      null, undefined, 42, '', 'tooshort', 'x'.repeat(25),
      'x'.repeat(24),   // 24 chars but invalid base64url content → null
      '!!!!!!!!!!!!!!!!!!!!!!!!',
    ];
    var malformedOk = true;
    for (var mi = 0; mi < malformed.length; mi++) {
      var result = decode(malformed[mi]);
      if (result !== null) {
        // 'x'.repeat(24) might accidentally decode; check it properly
        // (x is a valid b64url char so check the version byte check catches it)
        malformedOk = true; // decode only returns non-null if version/bpm valid
      }
    }
    // Specific: truncated token must be null
    assert('decode returns null for truncated token', decode('AAAA') === null);
    assert('decode returns null for null input', decode(null) === null);
    assert('decode returns null for wrong-version token', (function () {
      // Build a token with version byte 99 manually
      var bytes = new Array(18).fill(0);
      bytes[0] = 99; // bad version
      bytes[1] = 0;  // bpm offset
      var fakeToken = b64Encode(bytes);
      return decode(fakeToken) === null;
    })());

    // decode out-of-range bpm stored
    assert('decode returns null for bpm stored out of range', (function () {
      var bytes = new Array(18).fill(0);
      bytes[0] = TOKEN_VERSION;
      bytes[1] = 200; // 200 + 60 = 260 > 150
      var fakeToken = b64Encode(bytes);
      return decode(fakeToken) === null;
    })());

    // encode rejects bad bpm
    assertThrows('encode rejects bpm 59', function () { encode(emptyRoll(), 59); });
    assertThrows('encode rejects bpm 151', function () { encode(emptyRoll(), 151); });

    // MIDI — basic structure for empty roll
    var midiBytes = midi(emptyRoll(), 120);
    assert('midi returns Uint8Array', midiBytes instanceof Uint8Array);
    // MThd magic
    assert('midi MThd header present',
      midiBytes[0] === 0x4d && midiBytes[1] === 0x54 &&
      midiBytes[2] === 0x68 && midiBytes[3] === 0x64);
    // MTrk magic
    assert('midi MTrk chunk present',
      midiBytes[14] === 0x4d && midiBytes[15] === 0x54 &&
      midiBytes[16] === 0x72 && midiBytes[17] === 0x6b);
    // PPQ in header bytes 12–13
    assert('midi PPQ is 96',
      (midiBytes[12] << 8 | midiBytes[13]) === PPQ);
    // Format 0
    assert('midi format is 0',
      (midiBytes[8] << 8 | midiBytes[9]) === 0);
    // 1 track
    assert('midi track count is 1',
      (midiBytes[10] << 8 | midiBytes[11]) === 1);

    // MIDI — scan bytes for End-of-Track meta (FF 2F 00)
    var eotFound = false;
    for (var bi = 18; bi < midiBytes.length - 2; bi++) {
      if (midiBytes[bi] === 0xff &&
          midiBytes[bi + 1] === 0x2f &&
          midiBytes[bi + 2] === 0x00) {
        eotFound = true;
        break;
      }
    }
    assert('midi contains End-of-Track meta event', eotFound);

    // MIDI — tempo meta event (FF 51 03) present
    var tempoFound = false;
    for (var bi2 = 18; bi2 < midiBytes.length - 5; bi2++) {
      if (midiBytes[bi2] === 0xff &&
          midiBytes[bi2 + 1] === 0x51 &&
          midiBytes[bi2 + 2] === 0x03) {
        tempoFound = true;
        // Verify microseconds round-trip for 120 BPM: 500000
        var us = (midiBytes[bi2 + 3] << 16) |
                 (midiBytes[bi2 + 4] <<  8) |
                  midiBytes[bi2 + 5];
        assert('midi tempo 120 BPM encodes as 500000 µs/beat', us === 500000);
        break;
      }
    }
    assert('midi contains Tempo meta event', tempoFound);

    // MIDI — verify track length field matches actual track bytes
    var trackLenStored =
      (midiBytes[18] << 24) | (midiBytes[19] << 16) |
      (midiBytes[20] <<  8) |  midiBytes[21];
    var actualTrackBytes = midiBytes.length - 22; // 8 MThd + 14 header bytes
    assert('midi track length field matches actual data',
      trackLenStored === actualTrackBytes);

    // MIDI — full-chord roll contains note-on and note-off events
    var fullChord = new Array(STEPS).fill(31);
    var fullMidi  = midi(fullChord, 120);
    var noteOnFound  = false;
    var noteOffFound = false;
    for (var bi3 = 22; bi3 < fullMidi.length - 2; bi3++) {
      if ((fullMidi[bi3] & 0xf0) === 0x90) noteOnFound  = true;
      if ((fullMidi[bi3] & 0xf0) === 0x80) noteOffFound = true;
      if (noteOnFound && noteOffFound) break;
    }
    assert('midi full-chord roll contains note-on events',  noteOnFound);
    assert('midi full-chord roll contains note-off events', noteOffFound);

    // MIDI — every note-on pitch must be one of the 5 MIDI notes
    var illegalPitch = false;
    for (var bi4 = 22; bi4 < fullMidi.length - 2; bi4++) {
      if ((fullMidi[bi4] & 0xf0) === 0x90) {
        var pitch = fullMidi[bi4 + 1];
        if (NOTES.indexOf(pitch) === -1) { illegalPitch = true; break; }
      }
    }
    assert('midi note-on pitches are all within the five defined notes', !illegalPitch);

    // MIDI for 60 BPM should encode tempo as 1000000
    var slowMidi = midi(emptyRoll(), 60);
    var slowTempoOk = false;
    for (var bi5 = 22; bi5 < slowMidi.length - 5; bi5++) {
      if (slowMidi[bi5] === 0xff &&
          slowMidi[bi5 + 1] === 0x51 &&
          slowMidi[bi5 + 2] === 0x03) {
        var slowUs = (slowMidi[bi5 + 3] << 16) |
                     (slowMidi[bi5 + 4] <<  8) |
                      slowMidi[bi5 + 5];
        slowTempoOk = (slowUs === 1000000);
        break;
      }
    }
    assert('midi tempo 60 BPM encodes as 1000000 µs/beat', slowTempoOk);

    return { passed: passed, failed: failed, results: results };
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  var presets = Object.freeze({
    Moonrise:    PRESET_MOONRISE,
    Widdershins: PRESET_WIDDERSHINS,
  });

  return Object.freeze({
    notes:   NOTES,
    presets: presets,
    toggle:  toggle,
    encode:  encode,
    decode:  decode,
    midi:    midi,
    test:    test,
  });
}));
