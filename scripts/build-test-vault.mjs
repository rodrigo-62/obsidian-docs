// Regenerates the sample notes in test-vault/ from scripts/vault-src/.
// Only ever writes inside test-vault/ (never .obsidian/), or into a folder under .scratch/ given
// as an argument (used for screenshots). Run: npm run vault:reset
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'scripts', 'vault-src');
// Optional target folder (for screenshots): only test-vault/ or somewhere inside .scratch/.
const target = process.argv[2] ? resolve(process.argv[2]) : join(root, 'test-vault');
if (target !== join(root, 'test-vault') && !target.startsWith(join(root, '.scratch') + '/')) throw new Error('target must be test-vault/ or inside .scratch/');
const vault = target;
const ZW = '​';

const notes = {
	'start.md': 'Start here.md',
	'essay.md': 'Essays/A Short History of Lighthouses.md',
	'overlap.md': 'Overlapping comments.md',
	'footnotes.md': 'Footnotes and embeds.md',
	'embedded.md': 'Embedded note.md',
	'nodocmode.md': 'Comments without doc mode.md',
	'plain.md': 'Plain note.md',
};

function write(rel, content) {
	const p = join(vault, rel);
	if (!p.startsWith(vault + '/')) throw new Error('refusing to write outside test-vault: ' + p);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, content);
	console.log('wrote', rel);
}

for (const [from, to] of Object.entries(notes)) {
	write(to, readFileSync(join(src, from), 'utf8').replaceAll('{ZW}', ZW));
}

// ---- Performance note: ~15k words, 100 threads ------------------------------
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const words = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
	'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis ' +
	'nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute ' +
	'irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint').split(' ');
const sentence = () => {
	const n = 8 + Math.floor(rand() * 14);
	const ws = Array.from({ length: n }, () => pick(words));
	ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
	return ws.join(' ') + '.';
};
const paragraphs = [];
const threads = {};
let words_total = 0;
const iso = (i) => new Date(Date.UTC(2026, 9, 1, 9, 0) + i * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
for (let p = 0; p < 100; p++) {
	const sentences = Array.from({ length: 9 }, sentence);
	const id = 'p' + p.toString(36).padStart(3, '0');
	const target = sentences[2];
	sentences[2] = `<!--c:${id}-->${target}<!--/c:${id}-->`;
	const para = sentences.join(' ');
	words_total += sentences.join(' ').split(/\s+/).length;
	if (p % 10 === 0) paragraphs.push(`## Section ${p / 10 + 1}`);
	paragraphs.push(para);
	const comments = [{ id: 'a1', parent: null, created: iso(p), body: sentence() + ' ' + sentence() }];
	const replies = p % 4;
	for (let r = 0; r < replies; r++) {
		comments.push({ id: 'a' + (r + 2), parent: r === 2 ? 'a1' : 'a' + (r + 1), created: iso(p + r + 1), body: sentence() });
	}
	threads[id] = { quote: target, created: iso(p), resolved: p % 7 === 0, comments };
}
const json = JSON.stringify(threads, null, 2).replace(/--(!?)>/g, '--$1\\u003e');
write(
	'Performance — very long note.md',
	`---\ndocs: true\n---\n\n# Performance — very long note\n\n(${words_total} words, 100 threads, every 7th resolved.)\n\n` +
		paragraphs.join('\n\n') +
		`\n\n<!--docs:threads\n${json}\n-->\n`,
);

// ---- A tiny PNG (64x40, two-colour) -------------------------------------------
function png(w, h) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2; // RGB
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 3 + 1)] = 0;
		for (let x = 0; x < w; x++) {
			const o = y * (w * 3 + 1) + 1 + x * 3;
			const on = (x >> 3) % 2 === (y >> 3) % 2;
			raw[o] = on ? 60 : 230;
			raw[o + 1] = on ? 110 : 230;
			raw[o + 2] = on ? 200 : 230;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
write('diagram.png', png(64, 40));
