import { describe, expect, it } from 'vitest';
import {
	GUARD,
	adjustDeletions,
	adjustInsertionPos,
	anchorText,
	closeMarker,
	detachedIds,
	generateId,
	openMarker,
	parseMarkers,
	planAnchorInsertion,
	planAnchorRemoval,
	planRepair,
	sanitizePastedMarkers,
	stripMarkers,
} from '../src/core/markers';
import { applyChanges, serializeThreadBlock } from '../src/core/threadStore';
import { createThread } from '../src/core/model';

const o = openMarker;
const c = closeMarker;

/** Insert a comment around the first occurrence of `text`. */
function comment(md: string, text: string, id: string) {
	const from = md.indexOf(text);
	if (from < 0) throw new Error('not found: ' + text);
	const plan = planAnchorInsertion(md, from, from + text.length, id);
	if (!plan.ok) throw new Error(plan.error);
	return { md: applyChanges(md, plan.changes), plan };
}

describe('parseMarkers', () => {
	it('finds a simple pair', () => {
		const md = `a ${o('k3f9')}commented${c('k3f9')} b`;
		const p = parseMarkers(md);
		expect(p.anchors.size).toBe(1);
		expect(anchorText(md, p.anchors.get('k3f9')!)).toBe('commented');
		expect(p.stray).toEqual([]);
	});

	it('supports overlapping and nested ranges', () => {
		const md = `${o('a')}one ${o('b')}two${c('a')} three${c('b')} ${o('x')}out ${o('y')}in${c('y')} er${c('x')}`;
		const p = parseMarkers(md);
		expect(anchorText(md, p.anchors.get('a')!)).toBe('one two');
		expect(anchorText(md, p.anchors.get('b')!)).toBe('two three');
		expect(anchorText(md, p.anchors.get('x')!)).toBe('out in er');
		expect(anchorText(md, p.anchors.get('y')!)).toBe('in');
	});

	it('supports ranges across paragraphs', () => {
		const md = `start ${o('p')}one\n\ntwo\n\nthree${c('p')} end`;
		expect(anchorText(md, parseMarkers(md).anchors.get('p')!)).toBe('one\n\ntwo\n\nthree');
	});

	it('ignores markers in fenced code, inline code and frontmatter', () => {
		const md = `---\nx: "${o('fm')}"\n---\n\`\`\`\n${o('f')}code${c('f')}\n\`\`\`\nand \`${o('i')}\` inline ${c('i')}\n~~~\n${o('t')}\n~~~\n`;
		const p = parseMarkers(md);
		expect(p.markers.map((m) => m.id)).toEqual(['i']); // only the close marker outside code
		expect(p.anchors.size).toBe(0);
		expect(p.stray.length).toBe(1);
	});

	it('ignores markers inside the thread block', () => {
		const t = { z: createThread(`${o('q')}`, `body with ${c('q')}`) };
		const md = `text\n\n${serializeThreadBlock(t)}\n`;
		expect(parseMarkers(md).markers).toEqual([]);
	});

	it('reports lone, reversed and duplicated markers as stray', () => {
		const md = `${o('lone')}a ${c('rev')}b${o('rev')} ${o('d')}x${c('d')} ${o('d')}y${c('d')}`;
		const p = parseMarkers(md);
		expect(p.anchors.has('lone')).toBe(false);
		expect(p.anchors.has('rev')).toBe(false);
		expect(anchorText(md, p.anchors.get('d')!)).toBe('x');
		expect(p.stray.map((m) => `${m.kind}:${m.id}`).sort()).toEqual(['close:d', 'close:rev', 'open:d', 'open:lone', 'open:rev']);
	});

	it('treats the guard as part of the marker', () => {
		const md = `- ${GUARD}${o('g')}item${c('g')}`;
		const p = parseMarkers(md);
		const a = p.anchors.get('g')!;
		expect(a.open.guard).toBe(true);
		expect(a.open.from).toBe(2);
		expect(stripMarkers(md)).toBe('- item');
	});
});

describe('generateId', () => {
	it('creates unique base36 ids that start with a letter', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 500; i++) {
			const id = generateId(seen);
			expect(id).toMatch(/^[a-z][a-z0-9]{3,}$/);
			expect(seen.has(id)).toBe(false);
			seen.add(id);
		}
	});

	it('avoids collisions even with a bad random source', () => {
		let n = 0;
		const rnd = () => ((n++ % 3) / 36);
		const taken = new Set(['aaaa']);
		expect(taken.has(generateId(taken, rnd))).toBe(false);
	});
});

describe('planAnchorInsertion', () => {
	it('wraps the selection', () => {
		const { md, plan } = comment('Hello brave world', 'brave', 'id1');
		expect(md).toBe(`Hello ${o('id1')}brave${c('id1')} world`);
		expect(plan.ok && md.slice(plan.textFrom, plan.textTo)).toBe('brave');
		expect(plan.ok && plan.quote).toBe('brave');
	});

	it('trims surrounding whitespace and newlines', () => {
		const md = 'one two \nthree';
		const plan = planAnchorInsertion(md, 3, md.indexOf('three'), 'x');
		expect(plan.ok && applyChanges(md, plan.changes)).toBe(`one ${o('x')}two${c('x')} \nthree`);
	});

	it('adds a guard at the start of a paragraph line', () => {
		const { md } = comment('Para one.\n\nPara two here.', 'Para two', 'g1');
		expect(md).toBe(`Para one.\n\n${GUARD}${o('g1')}Para two${c('g1')} here.`);
		expect(parseMarkers(md).anchors.get('g1')!.open.guard).toBe(true);
	});

	it('places the marker after list bullets, task boxes and quote markers, with a guard', () => {
		expect(comment('- item text', '- item', 'l').md).toBe(`- ${GUARD}${o('l')}item${c('l')} text`);
		expect(comment('- [ ] task text', '- [ ] task', 't').md).toBe(`- [ ] ${GUARD}${o('t')}task${c('t')} text`);
		expect(comment('> quoted text', '> quoted', 'q').md).toBe(`> ${GUARD}${o('q')}quoted${c('q')} text`);
		expect(comment('1. first', '1. first', 'n').md).toBe(`1. ${GUARD}${o('n')}first${c('n')}`);
		expect(comment('> [!note] Callout text', '> [!note] Callout', 'co').md).toBe(`> [!note] ${GUARD}${o('co')}Callout${c('co')} text`);
	});

	it('does not guard headings', () => {
		expect(comment('# Title here', '# Title', 'h').md).toBe(`# ${o('h')}Title${c('h')} here`);
	});

	it('does not guard mid-line markers', () => {
		expect(comment('The middle word', 'middle', 'm').md).toBe(`The ${o('m')}middle${c('m')} word`);
	});

	it('never ends a range at the start of the next line', () => {
		const md = 'first line\n- second';
		const plan = planAnchorInsertion(md, 0, md.indexOf('second'), 'e');
		expect(plan.ok && applyChanges(md, plan.changes)).toBe(`${GUARD}${o('e')}first line${c('e')}\n- second`);
	});

	it('nests inside an existing guarded range without adding a second guard', () => {
		const base = `${GUARD}${o('a')}Alpha beta${c('a')} gamma`;
		const plan = planAnchorInsertion(base, 0, base.indexOf(' beta'), 'b');
		const md = plan.ok ? applyChanges(base, plan.changes) : '';
		expect(md).toBe(`${GUARD}${o('a')}${o('b')}Alpha${c('b')} beta${c('a')} gamma`);
		const p = parseMarkers(md);
		expect(anchorText(md, p.anchors.get('a')!)).toBe('Alpha beta');
		expect(anchorText(md, p.anchors.get('b')!)).toBe('Alpha');
	});

	it('creates overlapping ranges', () => {
		let md = 'one two three four';
		md = comment(md, 'one two', 'a').md;
		const from = md.indexOf('two');
		const to = md.indexOf('three') + 5;
		const plan = planAnchorInsertion(md, from, to, 'b');
		md = plan.ok ? applyChanges(md, plan.changes) : md;
		const p = parseMarkers(md);
		expect(anchorText(md, p.anchors.get('a')!)).toBe('one two');
		expect(anchorText(md, p.anchors.get('b')!)).toBe('two three');
	});

	it('expands to whole inline code spans', () => {
		const md = 'see `some code` here';
		const plan = planAnchorInsertion(md, md.indexOf('code'), md.indexOf(' here'), 'ic');
		expect(plan.ok && applyChanges(md, plan.changes)).toBe(`see ${o('ic')}\`some code\`${c('ic')} here`);
	});

	it('refuses ranges that start or end inside fenced code or frontmatter', () => {
		const md = '---\na: 1\n---\ntext\n```\ncode\n```\nafter';
		expect(planAnchorInsertion(md, md.indexOf('code'), md.indexOf('after') + 3, 'x').ok).toBe(false);
		expect(planAnchorInsertion(md, 4, md.indexOf('text') + 2, 'x').ok).toBe(false);
	});

	it('allows a range that fully contains a code block', () => {
		const md = 'before\n```\ncode\n```\nafter';
		expect(planAnchorInsertion(md, 0, md.length, 'x').ok).toBe(true);
	});

	it('refuses empty and whitespace-only selections', () => {
		expect(planAnchorInsertion('a   b', 1, 4, 'x').ok).toBe(false);
		expect(planAnchorInsertion('abc', 1, 1, 'x').ok).toBe(false);
	});

	it('never puts markers inside the thread block', () => {
		const md = `text\n\n${serializeThreadBlock({ z: createThread('q', 'b') })}\n`;
		const plan = planAnchorInsertion(md, 0, md.length, 'x');
		expect(plan.ok && applyChanges(md, plan.changes).startsWith(`${GUARD}${o('x')}text${c('x')}\n\n<!--folio:threads`)).toBe(true);
	});
});

describe('removal and repair', () => {
	it('removes both markers and the guard', () => {
		const md = `- ${GUARD}${o('a')}item${c('a')} text`;
		expect(applyChanges(md, planAnchorRemoval(md, ['a']))).toBe('- item text');
	});

	it('keeps the guard for a following marker that still needs it', () => {
		const md = `${GUARD}${o('a')}${o('b')}Alpha${c('b')} beta${c('a')}`;
		const out = applyChanges(md, planAnchorRemoval(md, ['a']));
		expect(out).toBe(`${GUARD}${o('b')}Alpha${c('b')} beta`);
		expect(parseMarkers(out).anchors.get('b')!.open.guard).toBe(true);
	});

	it('repairs strays, unknown ids and empty ranges', () => {
		const md = `${o('lone')}x ${o('ok')}good${c('ok')} ${o('nothread')}y${c('nothread')} ${o('empty')}${c('empty')}`;
		const out = applyChanges(md, planRepair(md, new Set(['ok', 'lone', 'empty'])));
		expect(out).toBe(`x ${o('ok')}good${c('ok')} y `);
	});

	it('lists detached thread ids', () => {
		const md = `${o('a')}x${c('a')}`;
		expect(detachedIds(['a', 'b'], parseMarkers(md))).toEqual(['b']);
	});
});

describe('adjustInsertionPos (typing at range boundaries)', () => {
	const md = `ab${o('x')}cd${c('x')}ef`;
	const p = parseMarkers(md);
	const a = p.anchors.get('x')!;

	it('moves text typed at the end of a range outside it', () => {
		expect(adjustInsertionPos(a.textTo, p)).toBe(a.close.to);
	});

	it('moves text typed at the start of a range outside it', () => {
		expect(adjustInsertionPos(a.textFrom, p)).toBe(a.open.from);
	});

	it('leaves insertions inside the text alone', () => {
		expect(adjustInsertionPos(a.textFrom + 1, p)).toBe(a.textFrom + 1);
		expect(adjustInsertionPos(0, p)).toBe(0);
	});

	it('chooses the shallowest spot between adjacent ranges', () => {
		const m2 = `${o('a')}one${c('a')}${o('b')}two${c('b')}`;
		const p2 = parseMarkers(m2);
		const pos = adjustInsertionPos(p2.anchors.get('a')!.textTo, p2);
		expect(pos).toBe(p2.anchors.get('a')!.close.to);
	});
});

describe('adjustDeletions', () => {
	it('protects a marker whose partner survives (deleting across a range start)', () => {
		const md = `ab${o('x')}cd${c('x')}ef`;
		const p = parseMarkers(md);
		const r = adjustDeletions(md, [{ from: 1, to: md.indexOf('d') }], p);
		const out = applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })));
		expect(out).toBe(`a${o('x')}d${c('x')}ef`);
		expect(r.orphaned).toEqual([]);
	});

	it('deletes both markers when the whole range is deleted (orphan)', () => {
		const md = `ab${o('x')}cd${c('x')}ef`;
		const p = parseMarkers(md);
		const r = adjustDeletions(md, [{ from: 1, to: md.length - 1 }], p);
		expect(applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })))).toBe('af');
		expect(r.orphaned).toEqual(['x']);
	});

	it('removes the markers when all commented text is deleted', () => {
		const md = `ab${o('x')}cd${c('x')}ef`;
		const a = parseMarkers(md).anchors.get('x')!;
		const r = adjustDeletions(md, [{ from: a.textFrom, to: a.textTo }], parseMarkers(md));
		expect(applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })))).toBe('abef');
		expect(r.orphaned).toEqual(['x']);
	});

	it('Backspace right after a hidden start marker deletes the character before it', () => {
		const md = `ab${o('x')}cd${c('x')}`;
		const a = parseMarkers(md).anchors.get('x')!;
		// CodeMirror's atomic ranges turn this backspace into a deletion of the marker itself
		const r = adjustDeletions(md, [{ from: a.open.from, to: a.open.to }], parseMarkers(md), 'backward');
		expect(applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })))).toBe(`a${o('x')}cd${c('x')}`);
	});

	it('Delete right before a hidden end marker deletes the character after it', () => {
		const md = `${o('x')}cd${c('x')}ef`;
		const a = parseMarkers(md).anchors.get('x')!;
		const r = adjustDeletions(md, [{ from: a.close.from, to: a.close.to }], parseMarkers(md), 'forward');
		expect(applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })))).toBe(`${o('x')}cd${c('x')}f`);
	});

	it('lets stray markers be deleted', () => {
		const md = `ab${o('lone')}cd`;
		const r = adjustDeletions(md, [{ from: 1, to: md.length - 1 }], parseMarkers(md));
		expect(applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })))).toBe('ad');
	});

	it('handles nested ranges: deleting the inner text orphans only the inner thread', () => {
		const md = `${o('out')}x ${o('in')}y${c('in')} z${c('out')}`;
		const p = parseMarkers(md);
		const inn = p.anchors.get('in')!;
		const r = adjustDeletions(md, [{ from: inn.textFrom, to: inn.textTo }], p);
		const out = applyChanges(md, r.ranges.map((d) => ({ ...d, insert: '' })));
		expect(out).toBe(`${o('out')}x  z${c('out')}`);
		expect(r.orphaned).toEqual(['in']);
	});
});

describe('stripMarkers / sanitizePastedMarkers', () => {
	it('strips markers and guards for the clipboard', () => {
		expect(stripMarkers(`${GUARD}${o('a')}Hi${c('a')} there`)).toBe('Hi there');
	});

	it('keeps zero-width spaces that are not guards', () => {
		expect(stripMarkers(`a${GUARD}b`)).toBe(`a${GUARD}b`);
	});

	it('keeps a pasted pair that restores a detached thread, strips the rest', () => {
		const text = `${o('det')}x${c('det')} ${o('live')}y${c('live')} ${o('unknown')}z${c('unknown')}`;
		const out = sanitizePastedMarkers(text, new Set(['det', 'live']), new Set(['live']));
		expect(out).toBe(`${o('det')}x${c('det')} y z`);
	});
});
