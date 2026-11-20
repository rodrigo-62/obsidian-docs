// Shared by install-plugin.mjs and update-vaults.mjs: install the built plugin into a
// vault, and move an earlier install made under the old name ("Folio", id "folio").
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ID = 'docs';
const OLD_ID = 'folio';

function readJson(p, fallback) {
	try {
		return JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Suggested shortcuts (not set by the plugin itself: Obsidian's guidelines forbid default hotkeys). */
export const SUGGESTED_HOTKEYS = {
	'docs:add-comment': [{ modifiers: ['Mod', 'Alt'], key: 'M' }],
	'docs:copy-for-llm': [{ modifiers: ['Mod', 'Alt'], key: 'C' }],
	'docs:footnote': [{ modifiers: ['Mod', 'Alt'], key: 'F' }],
	'docs:next-comment': [{ modifiers: ['Mod', 'Alt'], key: '.' }],
	'docs:previous-comment': [{ modifiers: ['Mod', 'Alt'], key: ',' }],
	'docs:next-heading': [{ modifiers: ['Mod', 'Alt'], key: 'ArrowDown' }],
	'docs:previous-heading': [{ modifiers: ['Mod', 'Alt'], key: 'ArrowUp' }],
};

/** Returns a list of human-readable notes about what was done. Throws if `vault` isn't a vault. */
export function installInto(vault) {
	const root = resolve(vault);
	const cfg = join(root, '.obsidian');
	if (!existsSync(cfg)) throw new Error(`${root} has no .obsidian folder; is it an Obsidian vault?`);
	for (const f of ['dist/main.js', 'dist/styles.css']) if (!existsSync(f)) throw new Error(`${f} is missing; run "npm run build" first.`);
	const notes = [];
	const dest = join(cfg, 'plugins', ID);
	mkdirSync(dest, { recursive: true });
	copyFileSync('dist/main.js', join(dest, 'main.js'));
	copyFileSync('dist/styles.css', join(dest, 'styles.css'));
	copyFileSync('manifest.json', join(dest, 'manifest.json'));
	notes.push(`installed into ${dest}`);

	// --- move an install made under the old name -----------------------------
	const old = join(cfg, 'plugins', OLD_ID);
	const oldManifest = readJson(join(old, 'manifest.json'), null);
	if (oldManifest && oldManifest.id === OLD_ID && oldManifest.author === 'Rodrigo Monteiro') {
		if (existsSync(join(old, 'data.json')) && !existsSync(join(dest, 'data.json'))) {
			copyFileSync(join(old, 'data.json'), join(dest, 'data.json'));
			notes.push('kept your settings from the old Folio install');
		}
		if (existsSync(join(old, '.hotreload'))) writeFileSync(join(dest, '.hotreload'), '');
		rmSync(old, { recursive: true, force: true });
		notes.push('removed the old Folio plugin folder');
	}
	const listPath = join(cfg, 'community-plugins.json');
	const list = readJson(listPath, null);
	if (Array.isArray(list) && list.includes(OLD_ID)) {
		const next = [...new Set(list.map((x) => (x === OLD_ID ? ID : x)))];
		writeFileSync(listPath, JSON.stringify(next, null, 2));
		notes.push('enabled "Docs" in place of "Folio"');
	}
	const hkPath = join(cfg, 'hotkeys.json');
	const hk = readJson(hkPath, null);
	if (hk && typeof hk === 'object' && Object.keys(hk).some((k) => k.startsWith(`${OLD_ID}:`))) {
		const next = {};
		for (const [k, v] of Object.entries(hk)) next[k.startsWith(`${OLD_ID}:`) ? `${ID}:${k.slice(OLD_ID.length + 1)}` : k] = v;
		writeFileSync(hkPath, JSON.stringify(next, null, 2));
		notes.push('renamed your custom Folio hotkeys');
	}
	// Suggested hotkeys for commands that have none yet (never overrides yours).
	const current = readJson(hkPath, {}) ?? {};
	const added = Object.keys(SUGGESTED_HOTKEYS).filter((k) => !(k in current));
	if (added.length) {
		for (const k of added) current[k] = SUGGESTED_HOTKEYS[k];
		writeFileSync(hkPath, JSON.stringify(current, null, 2));
		notes.push(`added ${added.length} suggested hotkey${added.length === 1 ? '' : 's'} (Ctrl+Alt+M/C/F/./,/↓/↑) where you had none`);
	}
	return notes;
}
