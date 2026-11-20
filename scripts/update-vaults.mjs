// Install the freshly built plugin into every vault listed in .install-targets
// (one absolute vault path per line; # comments allowed). Run via:
//   npm run update-vaults        (builds first, then copies)
// Only the plugin's own files are replaced; notes and the plugin's settings stay.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installInto } from './install-lib.mjs';

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
	try {
		for (const n of installInto(v)) console.log(`${resolve(v)}: ${n}`);
		// Lets the Hot Reload plugin (if installed in that vault) reload the plugin automatically.
		const marker = join(resolve(v), '.obsidian', 'plugins', 'docs', '.hotreload');
		if (!existsSync(marker)) writeFileSync(marker, '');
		ok++;
	} catch (e) {
		console.error(`skip ${v}: ${e.message}`);
	}
}
console.log(ok ? `Done (${ok} vault${ok === 1 ? '' : 's'}). Without Hot Reload there: toggle Docs off/on, or Ctrl+P → "Reload app without saving".` : 'Nothing updated.');
