# Start here

This is the Folio test vault. It is safe to edit anything here. Reset it with `npm run vault:reset`.

| Note | What it tests |
|---|---|
| [[Sample essay]] | Sample essay, doc mode (light), threads with replies, resolved thread, footnotes, highlight, private comment |
| [[Overlapping comments]] | Overlap, nesting, multi-paragraph ranges, list/quote starts, code blocks, a lone marker, a detached thread, dark page theme |
| [[Footnotes and embeds]] | Footnotes (incl. inline and multi-paragraph), note/section/image embeds for Copy for LLM |
| [[Embedded note]] | Embedded by the note above; has its own comment |
| [[Comments without doc mode]] | Comments render although doc mode is off |
| [[Plain note]] | Control note: no doc mode, no comments |
| [[Performance — very long note]] | ~15k words and 100 threads |

See `docs/TESTING.md` in the repo for the manual test checklist.
