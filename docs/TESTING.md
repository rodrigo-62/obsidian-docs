# Manual testing checklist

Claude can't see Obsidian's UI, so these are the by-hand checks. Each step says what you should see. Tick them off, and note anything wrong next to the step.

## Setup (once)

1. `cd` into the repo and run `nix develop`, then `npm install`.
2. Run `npm run dev`, and leave it running (it rebuilds into `test-vault/.obsidian/plugins/folio/`).
3. In Obsidian: *Open another vault → Open folder as vault →* choose `test-vault/` **inside this repo**.
4. If asked, choose **Trust author and enable plugins** (or Settings → Community plugins → turn off Restricted mode). Make sure **Folio** and **Hot Reload** are both on.
5. Optional: open the developer console (Ctrl+Shift+I). You should see `[folio] loaded` and no red errors.
6. If you mess up the notes: run `npm run vault:reset` (this only rewrites the sample notes).

## Phase 0: setup

- [ ] The vault opens and shows *Start here*, with a table linking 7 notes.
- [ ] Settings → Community plugins lists Folio 0.1.0 as enabled.

## Phase 2: comment core

No UI yet. This phase is covered by unit tests (`npm test`). Nothing to check by hand.

## Phase 3: copy for LLM

Open *Essays/A Short History of Lighthouses*. Paste results into any text editor to check them.

- [ ] A clipboard icon appears in the note's header (top-right). Click it. A notice says **"Copied: 6xx words, 6 threads (1 resolved omitted)"**.
- [ ] The pasted text starts with `<document title="A Short History of Lighthouses">` and a `<notation>` block. The headings read `# ⟦c1⟧A Short History of Lighthouses:⟦/c1⟧ Light at the Edge of the Map`.
- [ ] No `<!--`, no `folio` keys and no "Remember to cite the harbour records passage" (private comment) appear in the paste.
- [ ] `<footnotes>` lists `[^1]`, `[^2]` (the inline one about *whale oil*) and `[^3]`, in that order.
- [ ] In `<comments>`, thread c2 has 4 comments; `c2.3` has `reply-to="c2.1"` and `c2.4` has `reply-to="c2.2"`. Dates are in your local time.
- [ ] Command palette → **Folio: Copy for LLM including resolved comments**. Now 7 threads, and the "debt … sourced" thread has `status="resolved"`.
- [ ] Select a sentence → right-click → **Copy selection for LLM**. Only threads touching the selection are included, and the notation says it's an excerpt.
- [ ] Command palette → **Folio: Copy for LLM (choose options)…**. A modal with Content / Selection / Resolved / Embeds / Private options appears, and **Copy** works.
- [ ] Open *Footnotes and embeds* → Copy for LLM. The paste contains `<embed source="Embedded note">` with that note's text (no `<!--c:` markers), `<embed source="Embedded note#Second section">`, and `[image: diagram.png — A small test diagram]`.
- [ ] **Ctrl+Alt+C** (default hotkey) also copies.
- [ ] Settings → Folio → turn off *Header buttons*. The clipboard icon disappears from open notes.

## Phase 4: editor integration

Use *Comments without doc mode* and *Overlapping comments*, in Live Preview unless stated otherwise.

- [ ] No `<!--c:…-->` markers and no `<!--folio:threads` block are visible anywhere, in Live Preview **and** Source mode (toggle with Ctrl+E). The note ends after its last paragraph (plus one empty line).
- [ ] Commented text has a soft yellow highlight. In *Overlapping comments*, the middle clause of "Overlap" (in both ranges) is visibly darker, and so is the nested inner phrase.
- [ ] The `html` code block and the inline code in "Code is ignored" show their `<!--c:zz99-->` text literally, with no highlight.
- [ ] Click inside highlighted text. That highlight gets stronger with an underline (it is now "active"). Click plain text and it goes back to normal.
- [ ] Arrow keys move over the hidden markers without getting "stuck" (one key press per visible character).
- [ ] Put the cursor at the end of a highlighted word and type `xyz`. The new text is **not** highlighted. Same at the start of a highlight.
- [ ] Put the cursor right after the start of a highlight (visually at its first letter) and press Backspace. The character *before* the highlight is deleted, and the highlight stays intact.
- [ ] Select a phrase that starts before a highlight and ends inside it, then press Delete. The highlight shrinks but survives.
- [ ] Select exactly a whole highlighted phrase and delete it. The highlight disappears. Ctrl+Z brings back the text *and* its highlight.
- [ ] Select some text that includes a highlight and press Ctrl+C. Paste into another app: no `<!--` markers.
- [ ] Ctrl+A then Delete in a test note. The text is gone. Switch to Source mode: still no thread block visible. Ctrl+Z restores everything.
- [ ] Press Ctrl+End and type a letter. It appears at the end of the visible text, not after a hidden block.
- [ ] In *Plain note*, select a word and press **Ctrl+Alt+M** (or right-click → *Add comment*, or the speech-bubble header button). A modal opens with the quote and a focused text box. Type something and press **Ctrl+Enter**: the word is now highlighted. (Phase 5 replaces the modal with a margin card.)
- [ ] Start a comment, then press Esc in the modal. Nothing changes in the note (check Source mode).
- [ ] Select text inside a code block and press Ctrl+Alt+M. A notice says comments can't start or end inside a code block.
- [ ] Command palette → **Folio: Repair comment markers in this note** in *Overlapping comments*. The notice reports 1 removed marker (the lone `lone` start marker).

## Phase 5: margin cards

Make the Obsidian window wide (≥ 1100 px editor pane). Open *Essays/A Short History of Lighthouses* in Live Preview.

- [ ] Comment cards appear in a column **to the right of the text**, each roughly level with its highlighted text. The text column moves a little to the left to make room. Cards never overlap.
- [ ] Scroll: the cards scroll together with the text, without lagging or jumping.
- [ ] Hover a card: its highlight in the text gets stronger. Move away and it softens.
- [ ] Click a card: its text is selected, the card gets a shadow and a coloured border and expands to show all comments plus a "Reply…" box. Cards above it shift up and cards below shift down, so the active card stays level with its text.
- [ ] Click inside highlighted text in the editor: the matching card becomes active.
- [ ] The "Light and Distance" card, when inactive, shows the first comment, "2 more replies" and the last reply. When active, it shows all 4. The third comment shows a chip **↳ re: "The opening could say more about distance at sea"**. Click the chip and the first comment flashes.
- [ ] In that card, the second comment's `---` lines render as horizontal separators (not as a heading), and `**Check**` in the 4th comment is bold.
- [ ] Type a reply and press Ctrl+Enter. It appears at the bottom of the card. In Source mode, the JSON at the end has a new line with `"parent": "a4"` (the last comment).
- [ ] Hover a reply and click its ↩ icon. The reply box says "Replying to …". Send, and the new reply shows a ↳ re: chip if it isn't directly below its parent.
- [ ] Hover a reply and use ✎ to edit it. Save with Ctrl+Enter, and "(edited)" appears. Use 🗑 to delete it; it disappears, and Ctrl+Z in the editor brings it back.
- [ ] Click ✓ on a card. The card disappears and its highlight goes away. Command palette → **Folio: Toggle show resolved comments**: it comes back greyed with a "Resolved" badge and a ↺ button. Click ↺ to re-open it.
- [ ] ⋯ → **Delete thread** asks for confirmation, then removes the card, the highlight and the markers (check in Source mode).
- [ ] Select new text and press Ctrl+Alt+M. A "New comment" card appears in the margin level with the selection, with the cursor in it. Esc cancels and nothing is left behind. Again, type and Ctrl+Enter: the new card is active.
- [ ] Start a new comment, then click back into the text without typing. The empty draft disappears.
- [ ] *Overlapping comments*: a **Detached comments (2)** header with dashed cards for "dt5k" and "lone" appears below the end of the text (scroll down).
- [ ] Make the pane narrow (split the window or shrink it). The margin disappears and a **💬 N** pill appears top-right. Click it: the **Comments** sidebar opens on the right, listing the threads in document order with quotes. Clicking a sidebar card selects its text. Ctrl+Alt+M now opens the modal.
- [ ] Command palette → **Folio: Open comments sidebar** works in wide panes too. It follows the note you switch to.
- [ ] *Performance — very long note*: scrolling and typing stay smooth with 100 cards in the margin.
- [ ] Open the same note in two panes side by side (wide window). Both show cards. Replying in one pane updates the other.
