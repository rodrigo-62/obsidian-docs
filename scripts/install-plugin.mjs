// Install the built plugin into another vault:
//   npm run build && npm run install-plugin -- /path/to/vault
// Copies main.js, styles.css and manifest.json into <vault>/.obsidian/plugins/folio/.
// It does not enable the plugin; do that in Obsidian (Settings → Community plugins).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const vault = process.argv[2];
if (!vault) {
	console.error('usage: npm run install-plugin -- /path/to/vault');
	process.exit(1);
}
const root = resolve(vault);
if (!existsSync(join(root, '.obsidian'))) {
	console.error(`${root} has no .obsidian folder; is it an Obsidian vault?`);
	process.exit(1);
}
for (const f of ['dist/main.js', 'dist/styles.css']) {
	if (!existsSync(f)) {
		console.error(`${f} is missing; run "npm run build" first.`);
		process.exit(1);
	}
}
const dest = join(root, '.obsidian', 'plugins', 'folio');
mkdirSync(dest, { recursive: true });
copyFileSync('dist/main.js', join(dest, 'main.js'));
copyFileSync('dist/styles.css', join(dest, 'styles.css'));
copyFileSync('manifest.json', join(dest, 'manifest.json'));
console.log(`Installed Folio into ${dest}. Enable it in Settings → Community plugins (then reload Obsidian if it was already on).`);
