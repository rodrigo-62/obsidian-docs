# Decisions log

Decisions made autonomously where the spec said "confirm with me", "stop and ask", or left a gap. Newest at the bottom of each phase. ⚠ marks the ones most worth reviewing.

## Phase 0: setup and research

- **D0.1 ⚠ Build from scratch, don't fork.** Document Comments is the closest match, but its body format is linear and line-based and sits between paragraphs. The spec wants a tree, Markdown bodies, and one block at the end of the file. A fork would mean rewriting its parser, writer, cards and margin, and inheriting about 9k lines of features v1 doesn't need. Its ideas are reused instead (see `docs/RESEARCH.md`).
- **D0.2 ⚠ Storage format: §5.3 as written, plus three refinements.** (a) A U+200B "guard" before any marker that starts a non-heading line's text, because otherwise CommonMark turns the line into a raw HTML block and Reading view loses all formatting there (Document Comments hit this too). (b) `-->` and `--!>` inside the JSON are written as `-->` / `--!>` instead of `--\>`, since `\>` is invalid JSON while `>` is decoded by `JSON.parse` for free. (c) Anchor markers use exactly Document Comments' syntax `<!--c:ID-->…<!--/c:ID-->`.
- **D0.3 Zoom stays font-scaling (§4.2).** Note Zoom uses CSS `zoom` without any CodeMirror coordinate handling. That is the risk the spec names, and it would also skew the margin card positions. No reason to reconsider.
- **D0.4 Tooling.** nixpkgs-unstable flake with `nodejs_22`. Current versions: esbuild 0.28 (vitest 5 needs ≥0.27; the template pins 0.25), TypeScript 7, `obsidian` 1.14.4 typings, `@codemirror/state`/`view` pinned to the versions `obsidian` declares as peers. ESLint from the template was not carried over, to keep the toolchain small. The build is `tsc --noEmit` plus esbuild.
- **D0.5 Build output.** esbuild writes `dist/main.js` and `dist/styles.css` (CSS is bundled from `src/styles/index.css`). An `onEnd` hook copies them and `manifest.json` into `test-vault/.obsidian/plugins/folio/` and drops a `.hotreload` marker there. No symlinks, so it works the same everywhere.
- **D0.6 Test vault is generated.** The sample notes live in `scripts/vault-src/` and are written by `npm run vault:reset` (`scripts/build-test-vault.mjs`). That script refuses to write outside `test-vault/` and never touches `.obsidian/`. It also generates the ~13k-word, 100-thread performance note and a small PNG. The vault notes are committed too, so a clone works without running it.
- **D0.7 Hot Reload** 0.3.1 is copied from pjeby/hot-reload into the test vault, and both plugins are listed in `community-plugins.json`. The core *Footnotes* plugin is enabled in the test vault.
- **D0.8 License** is left `UNLICENSED`/private in `package.json`. Pick one before publishing.
