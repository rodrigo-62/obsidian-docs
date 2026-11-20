# Folio — Obsidian plugin

**`docs/SPEC.md` is the source of truth.** Read it before changing behaviour. Decisions that deviate from or fill gaps in the spec are in `docs/DECISIONS.md` (add new ones there with a reason). Manual UI checks for the user go in `docs/TESTING.md`, grouped by phase. Prior-art notes are in `docs/RESEARCH.md`.

## Working rules

- The user is mostly unavailable. Work autonomously: where the spec says "ask me", decide, then log the decision in `docs/DECISIONS.md`. Stop only if truly blocked, or if a step would touch files outside this repo.
- **Never touch any vault or file outside this repo.** Test only in `test-vault/`. Its notes are generated from `scripts/vault-src/` by `npm run vault:reset`.
- Phase order (the user's priority): 0, 2, 3, 4, 5, 6, then 1 last. Comments and copy-for-LLM matter most; page appearance matters least.
- After each phase: `npm test` and `npm run build` must pass. Then update `docs/TESTING.md` and the status section below, and commit with a clear message.
- `src/core/` is **pure TypeScript with no `obsidian` import**, unit-tested with vitest in `tests/`. Obsidian and CodeMirror glue goes in `src/obsidian/`.
- Notes are written through editor transactions when open, and through `app.vault.process` otherwise. Never use raw `vault.modify` on stale content. Frontmatter is written with `app.fileManager.processFrontMatter`.
- Page styling goes on the view's container element, **never on `body`**.

## Commands (run inside `nix develop`)

- `npm run dev`: watch build into `test-vault/.obsidian/plugins/folio/` (Hot Reload picks it up)
- `npm run build`: typecheck plus production build (also copied into the test vault)
- `npm test`: vitest for `src/core/`
- `npm run vault:reset`: regenerate the sample notes

## Storage format (summary; details in SPEC §5.3 and DECISIONS D0.2)

- Anchors: `<!--c:ID-->text<!--/c:ID-->`, ID `[a-z0-9]+` (generated: 4 chars). If a marker starts a non-heading line's text, a U+200B guard goes before it.
- Threads: a single `<!--folio:threads\n{pretty JSON}\n-->` block, always last in the file. `-->` is written as `-->`.
- Comments form a tree (`parent`) and are displayed flat, with "↳ re:" chips.

## Current status / next step

- **Done:** Phase 0 (setup, research, test vault). Phase 2 (core: `mdScan.ts`, `markers.ts`, `threadStore.ts`, `model.ts`, `commentStore.ts` façade; 82 tests).
- **Next:** Phase 3 (copy for LLM: `src/core/export.ts` plus tests, command, editor menu, header button).
