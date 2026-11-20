import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanFrontmatter, countWords, exportForLLM, exportSummary, extractSection, findEmbedTargets } from '../src/core/export';
import { inlineCommentStore as store } from '../src/core/commentStore';
import { GUARD, closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import type { Threads } from '../src/core/model';

const vaultSrc = (name: string) => readFileSync(join(__dirname, '..', 'scripts', 'vault-src', name), 'utf8').replaceAll('{ZW}', GUARD);

function note(body: string, threads: Threads): string {
	return `${body}\n\n${serializeThreadBlock(threads)}\n`;
}

const threads: Threads = {
	k3f9: {
		quote: 'A Short History of Lighthouses:',
		created: '2026-11-13T14:13:00Z',
		resolved: false,
		comments: [{ id: 'a1', parent: null, created: '2026-11-13T14:13:00Z', body: 'Is the title too long? Maybe drop the subtitle' }],
	},
	v8d2: {
		quote: 'Light and Distance',
		created: '2026-11-05T15:41:00Z',
		resolved: false,
		comments: [
			{ id: 'a1', parent: null, created: '2026-11-05T15:41:00Z', body: 'The opening could say more about distance at sea' },
			{ id: 'a2', parent: 'a1', created: '2026-11-13T14:33:00Z', body: '---\nOne idea: start with a ship' },
			{ id: 'a3', parent: 'a1', created: '2026-11-13T17:15:00Z', body: '"a coastline that is obvious by day disappears at night"' },
		],
	},
	res1: {
		quote: 'distance',
		created: '2026-11-06T10:00:00Z',
		resolved: true,
		comments: [{ id: 'a1', parent: null, created: '2026-11-06T10:00:00Z', body: 'resolved one' }],
	},
};

const body = `---
folio: true
folio-zoom: 120
tags: [draft]
---

# ${o('k3f9')}A Short History of Lighthouses:${c('k3f9')} Light at the Edge of the Map

## Introduction: ${o('v8d2')}Light and Distance${c('v8d2')}

For as long as ships have sailed there is a problem of ${o('res1')}distance${c('res1')}. A fire[^1] …

[^1]: The footnote text.`;

describe('exportForLLM — the spec example', () => {
	const md = note(body, threads);
	const { text, stats } = exportForLLM(md, threads, { title: '(draft 3) - A Short History of Lighthouses: Light at the Edge of the Map' });

	it('wraps the document with title and notation', () => {
		expect(text.startsWith('<document title="(draft 3) - A Short History of Lighthouses: Light at the Edge of the Map">\n<notation>\n')).toBe(true);
		expect(text).toContain('⟦cN⟧…⟦/cN⟧ marks the exact text that comment thread cN refers to.');
		expect(text).toContain('[^n] marks a footnote; definitions are in <footnotes>.');
	});

	it('writes milestones numbered in reading order', () => {
		expect(text).toContain('# ⟦c1⟧A Short History of Lighthouses:⟦/c1⟧ Light at the Edge of the Map');
		expect(text).toContain('## Introduction: ⟦c2⟧Light and Distance⟦/c2⟧');
	});

	it('removes the resolved thread (and its markers) by default', () => {
		expect(text).toContain('a problem of distance.');
		expect(text).not.toContain('resolved one');
		expect(stats).toMatchObject({ threads: 2, resolvedOmitted: 1 });
	});

	it('removes plugin syntax: markers, thread block, folio-* keys', () => {
		expect(text).not.toContain('<!--');
		expect(text).not.toContain('folio');
		expect(text).toContain('tags: [draft]');
	});

	it('moves footnote definitions to <footnotes>', () => {
		expect(text).toContain('<footnotes>\n[^1]: The footnote text.\n</footnotes>');
		expect(text.indexOf('[^1]: The footnote')).toBeGreaterThan(text.indexOf('</document>'));
	});

	it('writes threads with anchors, dates and reply-to', () => {
		expect(text).toContain('<thread id="c1" status="open" anchor="A Short History of Lighthouses:">\n  <comment id="c1.1" date="2026-11-13 14:13">Is the title too long? Maybe drop the subtitle</comment>\n</thread>');
		expect(text).toContain('<comment id="c2.2" date="2026-11-13 14:33">---\nOne idea: start with a ship</comment>');
		expect(text).toContain('<comment id="c2.3" reply-to="c2.1" date="2026-11-13 17:15">"a coastline that is obvious by day disappears at night"</comment>');
		expect(text).not.toContain('id="c2.2" reply-to');
	});

	it('orders the sections: document, footnotes, comments', () => {
		const d = text.indexOf('</document>');
		const f = text.indexOf('\n<footnotes>\n');
		const cm = text.indexOf('\n<comments>\n');
		expect(d).toBeLessThan(f);
		expect(f).toBeLessThan(cm);
	});

	it('counts words of the text only', () => {
		expect(stats.words).toBe(countWords('tags: [draft]\n# A Short History of Lighthouses: Light at the Edge of the Map\n## Introduction: Light and Distance\nFor as long as ships have sailed there is a problem of distance. A fire[^1] …'));
	});
});

describe('options', () => {
	const md = note(body, threads);

	it('includes resolved threads on request', () => {
		const { text, stats } = exportForLLM(md, threads, { includeResolved: true });
		expect(text).toContain('a problem of ⟦c3⟧distance⟦/c3⟧.');
		expect(text).toContain('<thread id="c3" status="resolved" anchor="distance">');
		expect(stats.resolvedOmitted).toBe(0);
	});

	it('comments only', () => {
		const { text } = exportForLLM(md, threads, { mode: 'comments', title: 'T' });
		expect(text).not.toContain('<document');
		expect(text).toContain('<comments document="T">');
		expect(text).toContain('anchor="Light and Distance"');
		expect(text).not.toContain('⟦');
	});

	it('text only', () => {
		const { text } = exportForLLM(md, threads, { mode: 'text' });
		expect(text).not.toContain('<comments');
		expect(text).not.toContain('⟦');
		expect(text).toContain('# A Short History of Lighthouses: Light at the Edge of the Map');
		expect(text).not.toContain('comment thread');
	});

	it('selection only: only intersecting threads, milestones clipped to the selection', () => {
		const from = md.indexOf('Short History');
		const to = md.indexOf('Introduction');
		const { text, stats } = exportForLLM(md, threads, { selection: { from, to } });
		expect(stats.threads).toBe(1);
		expect(text).toContain('⟦c1⟧Short History of Lighthouses:⟦/c1⟧ Light at the Edge of the Map');
		expect(text).toContain('anchor="A Short History of Lighthouses:"');
		expect(text).not.toContain('Light and Distance');
		expect(text).toContain('This is an excerpt');
		expect(text).not.toContain('tags:');
	});

	it('selection that starts inside a range opens the milestone at the start', () => {
		const from = md.indexOf('History');
		const to = md.indexOf(' Light at');
		const { text } = exportForLLM(md, threads, { selection: { from, to } });
		expect(text).toContain('⟦c1⟧History of Lighthouses:⟦/c1⟧');
	});

	it('uses a custom date format', () => {
		const { text } = exportForLLM(md, threads, { formatDate: () => 'DATE' });
		expect(text).toContain('date="DATE"');
	});
});

describe('notation details', () => {
	it('explains ==highlights== only when present', () => {
		expect(exportForLLM('plain text', {}).text).not.toContain('==text==');
		expect(exportForLLM('some ==marked== text', {}).text).toContain('==text== is highlighted text with no comment.');
		expect(exportForLLM('`==code==` only', {}).text).not.toContain('==text==');
	});

	it('omits the notation block for a plain note', () => {
		expect(exportForLLM('Just words.', {}, { title: 'P' }).text).toBe('<document title="P">\nJust words.\n</document>\n');
	});

	it('escapes attributes and bodies', () => {
		const t: Threads = {
			q: { quote: 'x', created: '', resolved: false, comments: [{ id: 'a1', parent: null, created: '', body: 'ends </comment> early?' }] },
		};
		const md = note(`say ${o('q')}"quoted" & <b>${c('q')} ok`, t);
		const { text } = exportForLLM(md, t, { title: 'A "title"' });
		expect(text).toContain('anchor="&quot;quoted&quot; &amp; &lt;b>"');
		expect(text).toContain('<document title="A &quot;title&quot;">');
		expect(text).toContain('ends <\\/comment> early?</comment>');
	});

	it('writes multi-line anchors as an <anchor> element', () => {
		const t: Threads = { m: { quote: '', created: '', resolved: false, comments: [{ id: 'a1', parent: null, created: '', body: 'b' }] } };
		const md = note(`${o('m')}one\n\ntwo${c('m')}`, t);
		const { text } = exportForLLM(md, t);
		expect(text).toContain('<thread id="c1" status="open">\n  <anchor>one\n\ntwo</anchor>');
	});

	it('lists detached threads after anchored ones, with the cached quote', () => {
		const t: Threads = {
			d: { quote: 'gone text', created: '2026-01-01T00:00:00Z', resolved: false, comments: [{ id: 'a1', parent: null, created: '2026-01-01T00:00:00Z', body: 'orphan' }] },
			a: { quote: 'here', created: '2026-02-01T00:00:00Z', resolved: false, comments: [{ id: 'a1', parent: null, created: '2026-02-01T00:00:00Z', body: 'x' }] },
		};
		const md = note(`${o('a')}here${c('a')}`, t);
		const { text, stats } = exportForLLM(md, t);
		expect(text).toContain('<thread id="c2" status="open" detached="true" anchor="gone text">');
		expect(text).toContain('detached="true" means the commented text was deleted');
		expect(stats.detached).toBe(1);
	});

	it('ignores stray markers and markers of unknown threads', () => {
		const md = `a ${o('lone')}b ${o('x')}c${c('x')} d`;
		expect(exportForLLM(md, {}).text).toContain('a b c d');
	});
});

describe('footnotes', () => {
	it('converts inline footnotes to numbered ones', () => {
		const { text } = exportForLLM('One.[^1] Two.^[Inline note.] Three.\n\n[^1]: First.', {});
		expect(text).toContain('One.[^1] Two.[^2] Three.');
		expect(text).toContain('<footnotes>\n[^1]: First.\n[^2]: Inline note.\n</footnotes>');
	});

	it('renumbers numeric labels by first reference', () => {
		const { text } = exportForLLM('A[^7] B^[inline] C[^2] D[^7]\n\n[^2]: two\n[^7]: seven\n[^9]: unused', {});
		expect(text).toContain('A[^1] B[^2] C[^3] D[^1]');
		expect(text).toContain('<footnotes>\n[^1]: seven\n[^2]: inline\n[^3]: two\n[^4]: unused\n</footnotes>');
	});

	it('keeps named labels and orders definitions by first reference', () => {
		const { text } = exportForLLM('A[^b] B[^a]\n\n[^a]: Def a.\n[^b]: Def b.', {});
		expect(text).toContain('[^b]: Def b.\n[^a]: Def a.');
	});

	it('handles multi-paragraph definitions', () => {
		const md = 'Text.[^long]\n\n[^long]: Para one.\n\n    Para two.\n\nAfter.';
		const { text } = exportForLLM(md, {});
		expect(text).toContain('[^long]: Para one.\n\n    Para two.');
		expect(text).toContain('Text.[^long]\n\nAfter.');
	});

	it('handles brackets inside inline footnotes', () => {
		const { text } = exportForLLM('X^[see [[Note]] and [link](u)] y', {});
		expect(text).toContain('X[^1] y');
		expect(text).toContain('[^1]: see [[Note]] and [link](u)');
	});

	it('keeps comment milestones inside footnotes', () => {
		const t: Threads = { f: { quote: 'q', created: '', resolved: false, comments: [{ id: 'a1', parent: null, created: '', body: 'b' }] } };
		const md = note(`T.[^1]\n\n[^1]: A ${o('f')}commented${c('f')} footnote.`, t);
		expect(exportForLLM(md, t).text).toContain('[^1]: A ⟦c1⟧commented⟦/c1⟧ footnote.');
	});
});

describe('private comments, code, embeds', () => {
	it('drops %% private %% comments by default, keeps them on request', () => {
		const md = 'Visible %%secret%% text.\n\n%%\nblock secret\n%%\n\nEnd.';
		const a = exportForLLM(md, {}).text;
		expect(a).toContain('Visible  text.');
		expect(a).not.toContain('secret');
		const b = exportForLLM(md, {}, { includePrivate: true }).text;
		expect(b).toContain('%%secret%%');
		expect(b).toContain('%%…%% is a private note-to-self');
	});

	it('leaves code untouched (markers, %%, == and footnotes inside code are literal)', () => {
		const md = '```\n<!--c:zz-->x<!--/c:zz--> %%a%% ==b== ^[c]\n```\nand `%%d%%`';
		const { text } = exportForLLM(md, {});
		expect(text).toContain('<!--c:zz-->x<!--/c:zz--> %%a%% ==b== ^[c]');
		expect(text).toContain('`%%d%%`');
		expect(text).not.toContain('<footnotes>');
	});

	it('inlines embedded notes, cleaned of their own markup', () => {
		const embedded = `---\nfolio: true\n---\n# Embedded\n\nIts ${o('e')}own${c('e')} text %%hidden%%. ![[deeper]]\n\n## Part\n\nPart text.\n\n${serializeThreadBlock({ e: { quote: 'own', created: '', resolved: false, comments: [] } })}\n`;
		const md = 'Before\n\n![[Embedded note]]\n\nMiddle\n\n![[Embedded note#Part]]\n\n![[missing]]';
		const { text } = exportForLLM(md, {}, { resolveEmbed: (t) => (t === 'Embedded note' ? embedded : null) });
		expect(text).toContain('<embed source="Embedded note">\n# Embedded\n\nIts own text . [embed: deeper]\n\n## Part\n\nPart text.\n</embed>');
		expect(text).toContain('<embed source="Embedded note#Part">\n## Part\n\nPart text.\n</embed>');
		expect(text).toContain('[embed: missing (not found)]');
		expect(text).toContain('<embed source="…">…</embed> holds the content');
	});

	it('leaves references only in reference mode', () => {
		const { text } = exportForLLM('![[Embedded note#Part]]', {}, { embeds: 'reference', resolveEmbed: () => 'x' });
		expect(text).toContain('[embed: Embedded note#Part]');
		expect(text).toContain('[embed: note] marks another note embedded');
	});

	it('turns images into [image: …] with alt text', () => {
		const { text } = exportForLLM('![[assets/diagram.png|A small diagram]] ![[pic.jpg|300]] ![Alt](https://x.org/a.png) ![[doc.pdf]]', {});
		expect(text).toContain('[image: diagram.png — A small diagram] [image: pic.jpg] [image: https://x.org/a.png — Alt] [embedded file: doc.pdf]');
		expect(text).toContain('[image: file — alt text] stands for an embedded image.');
	});

	it('finds embed targets for preloading', () => {
		expect(findEmbedTargets('![[A]] ![[B#x]] ![[c.png]] `![[D]]` ![[A|alias]]')).toEqual(['A', 'B']);
	});

	it('extracts sections and blocks', () => {
		const md = '# T\n\nintro\n\n## A\n\na text\n\n### A1\n\nsub\n\n## B\n\nb text\n\npara one\nline two ^blk\n';
		expect(extractSection(md, '#A')).toBe('## A\n\na text\n\n### A1\n\nsub');
		expect(extractSection(md, '#T#B')).toBe('## B\n\nb text\n\npara one\nline two ^blk');
		expect(extractSection(md, '#^blk')).toBe('para one\nline two');
		expect(extractSection(md, '#nope')).toBeNull();
	});
});

describe('frontmatter and summary', () => {
	it('removes folio keys including multi-line values', () => {
		expect(cleanFrontmatter('---\nfolio: true\nfolio-font: "X"\ntitle: T\nfolio-list:\n  - a\n  - b\ntags:\n  - x\n---\n')).toBe('---\ntitle: T\ntags:\n  - x\n---\n');
		expect(cleanFrontmatter('---\nfolio: true\n---\n')).toBe('');
	});

	it('formats the notice', () => {
		expect(exportSummary({ words: 2431, threads: 6, resolvedOmitted: 2, detached: 0 })).toBe('Copied: 2,431 words, 6 threads (2 resolved omitted)');
		expect(exportSummary({ words: 10, threads: 1, resolvedOmitted: 0, detached: 0 })).toBe('Copied: 10 words, 1 thread');
		expect(exportSummary({ words: 10, threads: 1, resolvedOmitted: 3, detached: 0 }, 'text')).toBe('Copied: 10 words');
	});
});

describe('sample notes', () => {
	it('essay exports cleanly', () => {
		const md = vaultSrc('essay.md');
		const doc = store.read(md);
		const { text, stats } = exportForLLM(md, doc.threads, { title: 'A Short History of Lighthouses' });
		expect(text).not.toMatch(/<!--|​|folio/);
		expect(stats).toMatchObject({ threads: 6, resolvedOmitted: 1 });
		expect(text).toContain('<comment id="c2.3" reply-to="c2.1"');
		expect(text).toContain('<comment id="c2.4" reply-to="c2.2"');
		expect(text).toContain('> ⟦c4⟧A light that cannot be told apart.⟦/c4⟧');
		expect(text).not.toContain('harbour records'); // private comment dropped
		expect(text).toContain('receives.[^2]'); // inline footnote numbered by position
		expect(text).toContain('morning.[^3]');
		expect(text).toMatch(/\[\^1\]: Coastal fires[^\n]*\n\[\^2\]: Some towers burned[^\n]*\n\[\^3\]: Cleaning mattered/);
		// every milestone is balanced
		for (let n = 1; n <= 6; n++) {
			expect(text.split(`⟦c${n}⟧`).length - 1).toBe(1);
			expect(text.split(`⟦/c${n}⟧`).length - 1).toBe(1);
		}
	});

	it('footnotes note exports embeds and footnotes', () => {
		const md = vaultSrc('footnotes.md');
		const embedded = vaultSrc('embedded.md');
		const { text } = exportForLLM(md, store.read(md).threads, { resolveEmbed: (t) => (t === 'Embedded note' ? embedded : null) });
		expect(text).toContain('<embed source="Embedded note">');
		expect(text).toContain('Its own comment markers must not leak');
		expect(text).toContain('<embed source="Embedded note#Second section">\n## Second section');
		expect(text).toContain('[image: diagram.png — A small test diagram]');
		expect(text).toContain('[^note]: The first footnote definition.');
		expect(text).toContain('[^1]: Inline footnotes are converted');
		expect(text).toContain('⟦c1⟧commented text next to a footnote⟦/c1⟧[^note]');
		expect(text).not.toContain('private note-to-self that');
		expect(text).not.toMatch(/<!--|​/);
	});
});
