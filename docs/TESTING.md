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
