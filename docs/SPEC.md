# Folio — a "Google Docs mode" plugin for Obsidian

> Working name: **Folio**. Rename freely (plugin id, CSS prefix and frontmatter keys all use `folio`).

## 0. Instructions for Claude Code

- This file is the spec. Read it fully before writing code.
- Work in the **phases** in §9, one at a time. At the end of each phase, stop and give me a short summary plus anything I need to test by hand.
- The items marked **DECISION** were open when this was written. Where §11 lists one as "confirm with me", ask before building on it.
- Keep the core logic (parsing, serialising, export) in **pure TypeScript with no Obsidian imports**, so it can be unit-tested with vitest. Obsidian-specific glue lives in a separate folder.
- The plugin **writes to my notes**. Never test against my real vault. Use the test vault described in §10.
- I use **NixOS** (see §10 for the dev environment).

---

## 1. What I want

I write long-form texts (essays and drafts) in Obsidian. I miss a few things from Google Docs, mainly its **comments**. I want a plugin that adds these Google-Docs-like features to Markdown notes, **turned on per note**:

1. **Page view.** Zoom, page width, font family and font size for this note only. No page breaks.
2. **Page theme.** Light or dark for this note's page only. The rest of the app keeps its theme.
3. **Comments (the main feature).** Select text, write a comment, and the text is highlighted. Comment cards sit in the right margin next to the text, like in Google Docs. I can reply to comments, including my own. This is single-user only, with no collaboration or sync logic.
4. **"Copy for LLM".** One button that copies the note as text an AI agent can fully understand. Anything that is only visual (highlight ranges, which comment refers to which text, reply structure, resolved state, footnotes) is spelled out in text.

Reference: in Google Docs, each comment card is level with its highlighted text in the right margin. The highlight of the active comment is darker than the others. Cards can be resolved with a ✓ button. My own comments often contain several thoughts separated by `---`.

## 2. Prior art (study this before building)

Several community plugins already cover parts of this. **Phase 0** is to look at them and recommend whether to fork one or build from scratch.

| Plugin | Relevance |
|---|---|
| **Document Comments** (kylemcd/obsidian-document-comments, MIT) | Margin comment cards with threads, stored inline as HTML comments. Desktop only. Closest to what I want. |
| **Notion-style Comments** (MIT fork of the above) | Adds a formatting toolbar, highlight colours, and iPad margin support. |
| **Inline Review Comments** | Shows Obsidian `%% %%` comments as margin cards in all three view modes. |
| **Margin Comments** | Threads and resolve. Stores data in a dot-folder, which Obsidian Sync skips. Avoid that storage choice. |
| **Note Zoom** | Per-tab or per-note zoom of note content. Look at how it implements zoom. |
| **Custom Note Width** / **Dynamic Font Size** | Per-note width and font size stored in frontmatter. |

What none of them do, as far as I know: all features together under one per-note switch, a per-page theme, **branching reply threads**, and a structured **copy-for-LLM** export. Phase 0 should check this.

## 3. Turning it on per note

- **Doc mode** is turned on by a frontmatter property. All settings live in the note, so they travel with the file (sync, git, copying).
- Use **flat keys**. Obsidian's Properties UI handles nested objects badly.

```yaml
---
folio: true
folio-zoom: 100          # percent
folio-width: 42          # page width, in em (scales with zoom and font size)
folio-font: "Times New Roman"
folio-font-size: 15      # pt, like Google Docs
folio-theme: light       # light | dark | app (follow the app)
---
```

- A missing key means "use the plugin default" (set in plugin settings).
- I should never need to edit the YAML by hand. The toolbar (§4.5) writes these keys with `app.fileManager.processFrontMatter`.
- Command: **"Folio: Toggle doc mode for this note"**.
- **Comments are independent of doc mode.** If a note contains comment markers (§5.3), comments are rendered even when doc mode is off. Otherwise the raw markers would show. Doc mode only controls the page appearance.

## 4. Page appearance

Apply everything by setting CSS classes and CSS custom properties on **that view's container element**, never on `body`. That keeps it per-note and per-pane. The same note may be open in two panes. Re-apply on `active-leaf-change`, `layout-change`, file open, and `metadataCache.on('changed')`.

### 4.1 Page look
- Doc mode gives a "page": a centred column with its own background and a subtle shadow, on a slightly different surround, like Google Docs.
- Width comes from `folio-width` in **em**, so zooming scales the width together with the text, like Google Docs zoom.

### 4.2 Zoom
- **DECISION: zoom by scaling, not with CSS `zoom` or `transform`.** Zoom multiplies the base font size, and since the page width is in em, everything scales together. CSS `zoom` and `transform: scale` can break CodeMirror's cursor and mouse coordinate mapping. If Phase 0 shows that Note Zoom uses CSS `zoom` reliably, we can reconsider.
- Controls: a toolbar dropdown (50–200 %, like Google Docs), commands for zoom in, zoom out and reset, and optionally Ctrl+Alt+scroll.

### 4.3 Font family and size
- Override `--font-text` and `--font-text-size`, or the right variables for the editor and the reading view. Check which variables Obsidian uses for each.
- Font picker: a curated list plus free text. Optionally use `window.queryLocalFonts()` if Electron allows it, and fall back to the list if not.
- Note: on NixOS, "Times New Roman" needs the unfree `corefonts` package. "Liberation Serif" or "Tinos" are metric-compatible free alternatives. The picker should show when a font isn't installed (`document.fonts.check`).

### 4.4 Per-page theme
- **DECISION: the plugin defines its own two palettes ("paper light" and "paper dark") and applies them by overriding Obsidian's CSS variables on the page container.** The variables include `--background-primary`, `--text-normal`, `--text-muted`, `--text-faint`, `--text-accent`, `--text-selection`, `--code-background`, `--blockquote-border-color`, link colours and the highlight colour.
- Don't rely on adding a `theme-dark` class to a sub-element. Some community themes scope their variables to `body.theme-dark`, so that trick is fragile. You can try it as an experiment.
- `app` means no override.
- Comment highlight colours need light and dark versions too.

### 4.5 Toolbar
- A slim bar at the top of the view, shown only in doc mode, like the Google Docs toolbar. It has: zoom, font, size − / +, width, theme toggle, **add comment**, **copy for LLM**, and **show resolved**.
- The comment and copy actions also need commands (with hotkeys) and an editor context-menu entry.

## 5. Comments

### 5.1 UX
- **Create:** select text, then use the hotkey (default `Ctrl+Alt+M`, as in Google Docs), the context menu or the toolbar. A card opens in the margin with a focused text box. `Ctrl+Enter` saves and `Esc` cancels. A cancelled empty comment leaves nothing behind.
- **Highlight:** the commented text gets a soft highlight. Hovering or focusing a card makes its highlight stronger. Clicking highlighted text activates its card, and clicking a card scrolls to and selects its text.
- **Overlap:** ranges may overlap or nest. Overlapping highlights get a darker colour.
- **Reply:** each card has a reply box, and **any** comment in the thread can be replied to (see §5.5).
- **Edit / delete** your own comments. Deleting the first comment of a thread deletes the whole thread and removes its anchor markers, after a confirmation.
- **Resolve** with ✓, like Google Docs. A resolved thread is hidden and its highlight removed, but it is kept. A "Show resolved" toggle shows them again greyed out, and they can be re-opened.
- **Comment bodies are Markdown**, rendered with `MarkdownRenderer.render`. `---` inside a comment should render as a separator, since I use it that way.
- **Orphans:** if the anchored text is deleted entirely, keep the thread and show it in a "Detached comments" section at the bottom of the margin. Google Docs does the same.

### 5.2 Where comments are shown
- **Default: cards in the right margin, scrolling with the text.** Render them in a layer inside the editor's scroll container, positioned with `view.coordsAtPos` / `lineBlockAt`. Use CodeMirror's measure cycle (`requestMeasure`) so it doesn't cause layout thrashing.
- **Layout algorithm:** each card wants its top edge level with the top of its anchor. Sort cards by anchor position and push them down to avoid overlap. The active card gets its ideal position and the cards around it shift up and down, which is how Google Docs behaves.
- **Narrow pane fallback:** if the pane is too narrow for page plus margin, switch to a right-sidebar `ItemView` that lists the threads in document order and highlights the active one.
- **Modes:** v1 supports Live Preview and Source mode. Reading view is a later phase, using a Markdown post-processor. Mobile is out of scope for v1 (`isDesktopOnly: true`).

### 5.3 Storage format
Comments are stored **inside the note**. They are portable, visible to agents and git, and survive Obsidian Sync. Anchors are **inline markers**, so they move with the text even when the file is edited outside Obsidian. Undo and redo work for free because the markers are text.

**DECISION (confirm in Phase 0 after studying Document Comments' format):**

- **Anchors** are paired HTML comments, which every Markdown renderer hides, unlike `%%`:
  `<!--c:k3f9-->commented text<!--/c:k3f9-->`
  IDs are short random base36 strings and must be unique in the file. Paired start and end markers, instead of a single wrapper, allow overlapping ranges and ranges across paragraphs.
- **Thread data** goes in one block at the **end of the file**, so the text stays clean. It is pretty-printed JSON, one thread per key, so git diffs stay readable:

```
<!--folio:threads
{
  "k3f9": {
    "quote": "Light and Distance",
    "created": "2026-11-05T15:41:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-05T15:41:00Z", "body": "The opening could say more directly why distance matters…" },
      { "id": "a2", "parent": "a1", "created": "2026-11-13T14:33:00Z", "body": "---\nOne idea: start with a ship approaching a dark coast…" }
    ]
  }
}
-->
```

- `quote` caches the anchored text when the comment is created, and is updated when the anchor changes. It's used for orphans and for export.
- `-->` inside comment bodies must be escaped, for example as `--\>`, and unescaped on read.
- Alternatives considered:
  - CriticMarkup `{==text==}{>>comment<<}`. It's readable, but bodies sit inline and clutter the text, and it can't express nesting or overlap well.
  - A sidecar JSON file. It keeps the Markdown fully clean, but anchors break on external edits and the pair of files has to survive renames and moves.
  - Keep the storage behind a `CommentStore` interface so the format can change later.

### 5.4 Editor integration (CodeMirror 6)
- A `StateField` parses the markers into a range map. A `ViewPlugin` or decorations hide the markers with `Decoration.replace` and mark them `atomicRanges`, so the cursor skips over them. The commented text gets `Decoration.mark`.
- **Edge cases that must be handled:**
  - **Copying** highlighted text inside Obsidian would copy the markers too. Strip markers in a `copy` / `cut` DOM handler. Also de-duplicate IDs on paste as a safety net.
  - **Deleting** a range that contains only one marker of a pair: repair or drop the lone marker, and mark the thread as an orphan if both are gone.
  - **Typing at the boundary** of a range: text typed right after the end marker is outside the range, as in Google Docs.
  - Markers inside code blocks or frontmatter are ignored.
  - The thread block at the end of the file is hidden in the editor (folded or replaced). It must never be edited by accident and must stay the last thing in the file.
- Writes go through editor transactions when the note is open, and through `app.vault.process` when it isn't. Never use raw `modify` on stale content.

### 5.5 Threading: linear or tree?
**Option A: linear (Google Docs).** Replies are appended in time order.
- Pros: simplest, fits a narrow margin, and reads like a conversation.
- Cons: in a long thread you can't see which earlier comment a reply refines.

**Option B: tree (Reddit).** Replies nest under the comment they answer.
- Pros: exact. Separate lines of thought stay apart, which is useful for working through my own ideas over time.
- Cons: indentation uses up a ~300 px margin quickly, deep threads become hard to read, and the UI is more complex.

**DECISION: store a tree, display it flat.**
- Every comment has a `parent`. Linear is just one way of displaying a tree, so the data never limits us.
- Default view: comments in time order. A reply whose parent is **not** the comment directly above it shows a small chip: `↳ re: "The opening could say more…"`. Clicking the chip flashes the parent. This is the quoted-reply pattern from chat apps.
- Each thread has an optional **tree view** toggle with indentation capped at 2 levels and collapsible branches.
- This gives Reddit's precision without the indentation cost.
- Later idea (not v1): anchor a reply to a selected part of another comment.

## 6. Copy for LLM

Copy the note as text with nothing left implicit. Produce it with a pure function `exportForLLM(markdown, threads, options)` and unit-test it thoroughly.

**Rules:**
- Remove the plugin's own syntax: the HTML anchor markers become the notation below, the thread block is removed, and the `folio-*` frontmatter keys are removed.
- Write comment ranges as **milestone markers** `⟦c1⟧ … ⟦/c1⟧`. These can overlap, which XML tags can't. Number the IDs in reading order (`c1`, `c2`, …) rather than using random IDs.
- Put the threads **after** the text. Each thread repeats the full anchored quote, shows status and dates, and gives each reply a `reply-to` attribute when it answers something other than the comment directly above.
- **Footnotes:** keep `[^n]` in the text and list the definitions in a `<footnotes>` section, even if they were written inline.
- `==highlight==` without a comment: keep it and explain it in the notation.
- **Embeds** `![[note]]`: by default, inline the embedded content in an `<embed source="note">` block. There's an option to leave it as a reference only. Images become `[image: filename — alt text]`.
- Obsidian `%% private %%` comments: excluded by default, with an option to include them.
- Start with a short `<notation>` block so the agent doesn't have to guess.
- Options in a modal or as separate commands:
  - include resolved threads (default off)
  - comments only
  - text only (no comments)
  - current selection only (only threads that intersect it)
- Show a notice after copying, e.g. "Copied: 2,431 words, 6 threads (2 resolved omitted)".

**Example output:**

```
<document title="(draft 3) - A Short History of Lighthouses: Light at the Edge of the Map">
<notation>
⟦cN⟧…⟦/cN⟧ marks the exact text that comment thread cN refers to. Ranges may overlap.
[^n] marks a footnote; definitions are in <footnotes>.
==text== is highlighted text with no comment.
Threads follow the document. Inside a thread, comments are in time order; reply-to names the earlier comment being answered when it is not the one directly above.
</notation>

# ⟦c1⟧A Short History of Lighthouses:⟦/c1⟧ Light at the Edge of the Map

## Introduction: ⟦c2⟧Light and Distance⟦/c2⟧

For as long as ships have sailed close to land, sailors have needed to know where the land ends. … a fire on a hill[^1] …
</document>

<footnotes>
[^1]: …
</footnotes>

<comments>
<thread id="c1" status="open" anchor="A Short History of Lighthouses:">
  <comment id="c1.1" date="2026-11-13 14:13">Is the title too long? Maybe drop the subtitle…</comment>
</thread>
<thread id="c2" status="open" anchor="Light and Distance">
  <comment id="c2.1" date="2026-11-05 15:41">The opening could say more directly why distance matters at sea…</comment>
  <comment id="c2.2" date="2026-11-13 14:33">---
One idea: start with a ship approaching a dark coast; …</comment>
  <comment id="c2.3" reply-to="c2.1" date="2026-11-13 17:15">"a coastline that is obvious by day disappears at night" …</comment>
</thread>
</comments>
```

## 7. Architecture

```
src/
  core/                 # pure TS, no 'obsidian' import, fully unit-tested
    markers.ts          # parse/insert/remove anchor markers, ID generation, repair
    threadStore.ts      # read/write the end-of-file JSON block, escaping
    model.ts            # Thread, Comment types; tree helpers (parent chips, tree view)
    export.ts           # exportForLLM()
    docSettings.ts      # frontmatter -> settings with defaults and clamping
  obsidian/
    main.ts             # Plugin class, commands, events, settings tab
    pageStyle.ts        # apply CSS vars/classes per view
    toolbar.ts
    cm/                 # CodeMirror 6: StateField, decorations, atomic ranges, clipboard
    margin/             # margin layer, card components, layout algorithm
    sidebarView.ts      # narrow-pane fallback ItemView
styles.css
tests/                  # vitest, for core/
```

- Start from the official `obsidian-sample-plugin` template, with esbuild and TypeScript.
- No UI framework is needed. Plain DOM with Obsidian's `createEl` helpers is enough. If the cards get complex, Svelte or Preact is acceptable.
- Clean up everything on `onunload` and when doc mode is turned off: CSS variables, classes, margin layers and listeners.

## 8. Non-goals (v1)

- Multi-user, sharing, sync of any kind, presence.
- Page breaks, headers and footers, print layout.
- Suggestion mode or tracked changes.
- Mobile.
- Canvas or PDF notes.

## 9. Phases

Each phase ends with a working build and a short report.

0. **Setup and research.** Set up the dev environment (§10) and the test vault. Read the Document Comments and Note Zoom source code. Report: their storage formats and how they lay out the margin, and a recommendation on fork vs build. If the recommendation is to change the storage format or zoom approach in §4.2 or §5.3, **stop and ask me**.
1. **Doc mode and page appearance.** Frontmatter keys, defaults, page look, zoom, width, font, size, per-page theme, toolbar, toggle command.
   *Done when* two panes with different notes look different, and the same note open in two panes stays consistent.
2. **Comment core.** `core/markers.ts`, `threadStore.ts`, `model.ts`, with tests: round-trip, overlap, escaping, orphan repair, duplicate IDs.
3. **Copy for LLM.** `core/export.ts` with tests, plus the command and button. It comes early because it's pure and I can use it right away.
4. **Editor integration.** Create a comment from a selection, hidden atomic markers, highlights, clipboard stripping, hidden thread block.
5. **Margin cards.** Layout algorithm, active state, replies with parent chips, edit, delete, resolve, show resolved, detached comments, narrow-pane sidebar fallback.
6. **Tree view and polish.** Per-thread tree toggle, keyboard navigation (next and previous comment), settings tab, and reading-view support if time allows.

## 10. Dev environment (NixOS)

- Node through a flake `devShell` or `shell.nix` with `nodejs_22`. Commit the shell file to the repo.
- Obsidian from nixpkgs (unfree: `allowUnfree`).
- A **dedicated test vault** in the repo (e.g. `test-vault/`) with sample notes: a long essay, overlapping comments, footnotes, embeds, a note with doc mode off but with comments, and a very long note for performance.
- `npm run dev` builds in watch mode into `test-vault/.obsidian/plugins/folio/`, either by symlink or by an output path set in esbuild. Install the **Hot Reload** plugin in the test vault.
- If fonts are needed, add them to `fonts.packages` in the system config. Don't do this from the plugin.

## 11. Risks and open questions to check early

- **Confirm with me:** the storage format (§5.3) and the decision whether to fork or build (Phase 0).
- CodeMirror coordinate mapping with scaled fonts and atomic replaced ranges. Prototype the margin layout early (a spike in Phase 1 is fine).
- Performance with ~100 threads in a 15k-word note. Margin layout must stay smooth while scrolling and typing.
- Interaction with other plugins that also change line width or font size.
- Exact CSS variable names for font and width in the current Obsidian version. Verify them instead of assuming.
