// Install the freshly built plugin into every vault listed in .install-targets
// (one absolute vault path per line; # comments allowed). Run via:
//   npm run update-vaults        (builds first, then copies)
// Only the plugin's own three files are replaced; notes and Folio's settings stay.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const list = '.install-targets';
if (!existsSync(list)) {
	console.error(`No ${list} file. Create it with one vault path per line, e.g.\n  echo /home/me/vault > ${list}`);
	process.exit(1);
}
const vaults = readFileSync(list, 'utf8')
	.split('\n')
	.map((l) => l.replace(/#.*/, '').trim())
	.filter(Boolean);
let ok = 0;
for (const v of vaults) {
	const root = resolve(v);
	if (!existsSync(join(root, '.obsidian'))) {
		console.error(`skip ${root}: no .obsidian folder`);
		continue;
	}
	const dest = join(root, '.obsidian', 'plugins', 'folio');
	mkdirSync(dest, { recursive: true });
	copyFileSync('dist/main.js', join(dest, 'main.js'));
	copyFileSync('dist/styles.css', join(dest, 'styles.css'));
	copyFileSync('manifest.json', join(dest, 'manifest.json'));
	// Lets the Hot Reload plugin (if installed in that vault) reload Folio automatically.
	if (!existsSync(join(dest, '.hotreload'))) writeFileSync(join(dest, '.hotreload'), '');
	console.log(`updated ${dest}`);
	ok++;
}
console.log(ok ? `Done (${ok} vault${ok === 1 ? '' : 's'}). Without Hot Reload there: toggle Folio off/on, or Ctrl+P → "Reload app without saving".` : 'Nothing updated.');
