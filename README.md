# Moonspool Cabinet

Punch a melody into a mechanical piano roll and listen to it play. Five pitches and sixteen positions give you one bar in 4/4. Holes in the same column sound together.

[Open the cabinet](https://marcodipolo.github.io/moonspool-cabinet/) · [Try the Moonrise roll](https://marcodipolo.github.io/moonspool-cabinet/#ASQBAAIABAAFAAgACQAQABEA)

## Play, edit and share

Select **Moonrise** or **Widdershins** and press **Play**. Pick any dot to punch or close a hole. The brightest column marks the current step. Turn the tempo from 60 to 150 BPM. The roll loops until you stop it. Use the arrow keys inside the grid and press Space or Enter to edit the focused note. **Undo** restores the last change, including a cleared roll.

**Export MIDI** saves a one-bar Standard MIDI File. The file contains the chords, note lengths, tempo and rests. It opens in software that supports Standard MIDI Files. **Copy roll link** puts the pattern and tempo in the URL fragment, so a friend can play the same roll without an account. The page offers a selectable link if the clipboard is unavailable.

For offline use, download the repository and open `index.html` in a current browser with JavaScript enabled. The instrument synthesises its own sound with the Web Audio API. It needs no samples, external fonts, server, account or API key. A relative link copied while playing offline works in another copy of the same folder.

## The build

The Resurrection entry brings a player-piano roll back as a hand-edited browser instrument. Marc's interest in stars and dark witchcraft shaped the lunar engravings, shadowed cabinet and repertoire. The interface emulates the act of punching paper. It does not read or manufacture physical piano rolls.

The project was created during Kiroween 2026. The source, artwork and two example phrases were produced for this project. Kiro CLI built the roll engine with our steering, API contract and custom project agent. [Kiro development notes](KIRO.md)

Run the tests with Node.js:

~~~sh
node --test test/roll.test.cjs
~~~

The tests decode MIDI bytes independently and compare the result with the original pattern. [MIT licence](LICENSE)

[Watch the 22-second demonstration](presentation/Moonspool-Cabinet-demo.mp4) · [English captions](presentation/moonspool.en.srt)
