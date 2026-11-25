# Working with Kiro

This project uses Kiro CLI 3.6.0 and a project agent called `rollmaker`. The agent received the [instrument brief](.kiro/steering/instrument.md) and the [format contract](.kiro/specs/roll-format/requirements.md). The brief sets the musical constraints. The contract defines the five note rows, shared links and MIDI output. The [agent configuration](.kiro/agents/rollmaker.json) supplies these resources without shell tools or external integrations.

Kiro wrote the first version of `roll.js`, including the two musical phrases and a single-track MIDI writer. Its first version passed its 40 internal checks. We separately tested the exported bytes using a MIDI event reader that does not call Kiro's writer. Among other cases, a completely empty roll must still end on tick 384. Simultaneous notes must start together, and a repeated note must end before its next attack.

We found two cases the first set of checks missed. A fractional tempo could be rounded silently, and a non-ASCII character in a shared link could decode as a zero byte. We added explicit regression tests and fed these two examples back to the same agent. Kiro's second implementation rejected malformed input, kept the original two melodies and preserved the encoding of 128 earlier example links. The tests now live outside the browser bundle.

The final checks cover all 80 hole positions, 1,024 shared-roll round trips across the supported tempo range, and 272 MIDI files decoded independently. The browser checks cover keyboard edits, undo after clearing, audio playback, a real MIDI download and reopening a copied link. The user interface, browser checks and recorded demonstration were integrated separately. The application runs offline after download.
