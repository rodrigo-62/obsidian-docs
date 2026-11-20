# Phase 0 research: prior art

Sources were cloned into `.scratch/` (gitignored, outside `src/`) on 2026-11-20 and skimmed.

## Document Comments (kylemcd/obsidian-document-comments)

**Storage.** Three kinds of HTML comment:

| Piece | Syntax | Where |
|---|---|---|
| Anchor start | `<!--c:ID-->` | immediately before the commented text |
| Anchor end | `<!--/c:ID-->` | immediately after it |
| Body | `<!--co:ID by:… at:… status:open quote:"…"` + one line per entry + `-->` | after the block (paragraph) that holds the anchor |

- IDs are 5 random base-36 characters. The parser keeps only the first occurrence of each ID.
- Threads are **linear**: one line per entry (`author (timestamp): text`). Newlines in an entry are `\n`-escaped, and `-->` is broken with a zero-width space (`--​>`).
- **Important finding:** a line whose text starts with `<!--` is a CommonMark *HTML block*. Reading view then renders the whole line raw, with no bold, links or highlights. Live Preview is unaffected. The fix is a **zero-width space (U+200B) in front of a marker that starts a line's text**, placed *after* any block markup (`- `, `> `, `1. `, `- [ ] `, callout, footnote label). Headings need no guard. Folio adopts this.
- Other lessons: don't put markers on rules, fences or setext underlines, right after a backslash, or inside indented or fenced code. Markers inside code are ignored.

**Margin layout.** A `ViewPlugin` adds a `div` to `view.dom` (outside the scroller) and repositions every card on every scroll event. Geometry is read inside `view.requestMeasure` (`coordsAtPos` throws during an update). Stacking is a simple top-down pass: sort by anchor top, `top = max(ideal, previousBottom + gap)`. The margin container stops propagation of mouse and keyboard events so CodeMirror doesn't steal them from card inputs. The column sits right of the readable-width text with CSS `calc()` on `--file-line-width`.

**Size.** About 9k lines of TS, with tables, reactions, authors, an agent "skill" and reading-view highlighting (860 lines on its own).

## Note Zoom (fusionc0rn/obsidian-note-zoom)

- Zooms with **CSS `zoom`** on the view's content element (`el.style.setProperty('zoom', z)`), per tab or per note, stored in plugin data (not in the note).
- There is no special handling for CodeMirror coordinates. Chromium ≥128 implements standardised CSS zoom, so this mostly works now. But CodeMirror measures layout in unzoomed CSS pixels while `getBoundingClientRect` returns zoomed ones, which is a known source of cursor and selection drift. It is also exactly what the margin layout needs to be precise.
- **Conclusion:** keep the spec's decision. Zoom by scaling the font size (and the width, which is in em), with no CSS `zoom`. Nothing in Note Zoom argues for reconsidering.

## Others (not cloned; from their READMEs and the registry)

- Notion-style Comments and Inline Review Comments are variants of the above. Margin Comments stores data in a dot-folder (skipped by Sync).
- Searching the community registry (2026-11-20) for comment, zoom, width and font plugins found none that combines a per-note switch, a per-page theme, **branching reply threads** and a structured **copy-for-LLM** export. "Agent Comments" and "Review Comments AI" target agents but only use inline syntax.

## Recommendation: build from scratch

- Document Comments' body format is linear and line-based, and its bodies sit *between paragraphs*. The spec wants a tree, Markdown bodies with `---`, and one clean block at the end of the file. Changing the format means rewriting the parser, writer, card UI and margin anyway.
- It carries a lot that v1 doesn't need (tables, reactions, authors, code-line anchors), plus a dependency (`better-result`).
- We reuse its **ideas**: the same anchor marker syntax, the U+200B line-start guard, event isolation in the margin, `requestMeasure`, stacking.

## Storage format: keep §5.3, with three refinements

1. **Line-start guard:** U+200B before a marker that starts a line's text (non-heading). It belongs to the marker (hidden with it, removed with it, stripped on copy and export).
2. **Escaping `-->`:** the spec suggests `--\>`, but `\>` is an invalid JSON escape. Folio writes `-->`, a valid JSON escape for `>`, so plain `JSON.parse` decodes it with no custom unescape step. `--!>` (which also closes an HTML comment) is escaped the same way.
3. The anchor markers are byte-compatible with Document Comments' anchors (`<!--c:ID-->`). Its bodies (`<!--co:`) are not read.

## Verified Obsidian CSS variables (app.css from Obsidian 1.15.1, the installed build)

- Editor font: `.markdown-source-view { font-size: var(--font-preferred-size); font-family: var(--font-text) }`, and the same for `.markdown-preview-view`.
- `body` sets `--font-text-size: 16px` and `--font-preferred-size: var(--font-text-size)`. **Overriding `--font-text-size` on a child does nothing**, because `--font-preferred-size` was already resolved on body. Override `--font-preferred-size` instead.
- Width: `.markdown-source-view.mod-cm6.is-readable-line-width .cm-sizer { max-width: var(--file-line-width) }` and `.markdown-preview-view.is-readable-line-width .markdown-preview-sizer`. Scroller padding is `--file-margins`.
- Theme colours: `.theme-light` / `.theme-dark` set `--color-base-00…100` and a few semantic overrides. `body` then defines about 240 semantic variables (`--background-primary: var(--color-base-00)`, …). As with fonts, overriding `--color-base-*` on a child does nothing, so the page palette has to **re-declare the semantic mappings** on the page container too. These are generated into `src/styles/palette.css`.
