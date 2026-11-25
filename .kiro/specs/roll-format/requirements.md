# Roll engine contract

The instrument must expose a classic browser global `MoonRoll` and CommonJS exports from the same roll.js file. The UI is separate. Provide the following public surface.

- `notes` lists ascending MIDI pitches 57, 60, 62, 64, 67.
- `presets.Moonrise` and `presets.Widdershins` hold distinct, newly composed example rolls, each of sixteen masks from 0 through 31.
- `toggle(pattern, step, noteIndex)` returns a fresh sixteen-step roll and flips just the indicated hole. Invalid inputs must never be silently wrapped into another pitch.
- `encode(pattern, bpm)` returns a compact, URL-fragment-safe, versioned token for an exact integer tempo of 60–150 and the sixteen masks. `decode(token)` returns `{pattern,bpm}` on success and null on malformed inputs.
- `midi(pattern,bpm)` returns a real single-track Standard MIDI File as Uint8Array with PPQ 96, a tempo event and sixteen steps of 24 ticks. Start simultaneous chord notes at the same tick, emit note-offs before the next step and preserve the final rest so the end tick is 384, including an empty roll. Use standard 7-bit MIDI data, variable-length delta times, a correct track length and a final end-of-track event.
- Validate with deterministic property tests across masks, tempos, toggling, shared URLs and independent event decoding. No dependencies, external content or network access are needed by the app.
