# Folio

A "Google Docs mode" for Obsidian: per-note page view and page theme, margin comments with branching reply threads, and a structured **Copy for LLM** export. Desktop only.

- Spec: `docs/SPEC.md` · Decisions: `docs/DECISIONS.md` · Manual checks: `docs/TESTING.md` · Prior art: `docs/RESEARCH.md`

## Develop (NixOS)

```sh
nix develop          # node 22
npm install
npm run dev          # watch build → test-vault/.obsidian/plugins/folio/ (Hot Reload picks it up)
npm test             # vitest (core + headless CodeMirror + happy-dom smoke tests)
npm run build        # typecheck + production build (also copied into the test vault)
npm run vault:reset  # regenerate the sample notes in test-vault/
```

Open `test-vault/` in Obsidian with *Open folder as vault*, and trust the plugins when asked.

## Install in another vault

```sh
nix develop
npm run build
npm run install-plugin -- /path/to/vault     # e.g. /home/parrhasius/vault
```

Then in Obsidian: Settings → Community plugins → enable **Folio**. To update later, repeat these steps and toggle Folio off and on (or restart Obsidian). Keep a backup or git history of the vault: Folio writes comments into notes.

## Checking the real UI (dev)

`scripts/obsidian-headless.sh` runs Obsidian headless on `test-vault/` with an isolated profile, and `scripts/cdp.mjs` evaluates JavaScript in it and takes screenshots.

## Storage format

Comments live inside the note. Anchors are paired HTML comments around the commented text, `<!--c:k3f9-->text<!--/c:k3f9-->`, with a zero-width space in front when a marker starts a line. Threads are one pretty-printed JSON block at the end of the file (`<!--folio:threads … -->`). Page settings are flat `folio-*` frontmatter keys.
