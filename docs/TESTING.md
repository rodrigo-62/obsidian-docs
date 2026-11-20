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
