import { describe, expect, it } from 'vitest';
import { footnoteAction, scanFootnotes } from '../src/core/footnotes';
import { applyChanges, serializeThreadBlock } from '../src/core/threadStore';
import { createThread } from '../src/core/model';

function run(md: string, cursor: number) {
	const a = footnoteAction(md, cursor);
	if (a.kind === 'toReference') return { a, out: md };
	return { a, out: applyChanges(md, a.changes) };
}

describe('footnotes', () => {
	it('inserts the first footnote and its definition at the end', () => {
		const md = 'Hello world.\n';
		const { a, out } = run(md, 5);
		expect(out).toBe('Hello[^1] world.\n\n[^1]: \n');
		expect(a.kind).toBe('insert');
		if (a.kind === 'insert') {
			expect(out.slice(0, a.cursor)).toBe('Hello[^1] world.\n\n[^1]: ');
			expect(out.slice(0, a.refEnd)).toBe('Hello[^1]');
		}
	});

	it('numbers after existing numeric labels and adds the definition after the last one', () => {
		const md = 'A[^1] B[^note] C.\n\n[^1]: one\n\n[^note]: named\n';
		const { out } = run(md, md.indexOf(' C') + 2);
		expect(out).toBe('A[^1] B[^note] C[^2].\n\n[^1]: one\n\n[^note]: named\n\n[^2]: \n');
	});

	it('keeps the definition before the hidden thread block', () => {
		const md = `Text.\n\n${serializeThreadBlock({ x: createThread('q', 'b') })}\n`;
		const { a, out } = run(md, 4);
		expect(out.startsWith('Text[^1].\n\n[^1]: \n\n<!--folio:threads')).toBe(true);
		if (a.kind === 'insert') expect(out.slice(0, a.cursor).endsWith('[^1]: ')).toBe(true);
	});

	it('a cursor right after a reference counts as on it (toggle back and forth)', () => {
		const md = 'See[^1] here.\n\n[^1]: Note.\n';
		expect(footnoteAction(md, md.indexOf(' here')).kind).toBe('toDefinition');
	});

	it('jumps from a reference to its definition and back', () => {
		const md = 'See[^1] here.\n\n[^1]: The note text.\n';
		const to = footnoteAction(md, md.indexOf('[^1]') + 2);
		expect(to.kind).toBe('toDefinition');
		if (to.kind === 'toDefinition') {
			expect(md.slice(0, to.pos).endsWith('The note text.')).toBe(true);
			const back = footnoteAction(md, to.pos);
			expect(back).toEqual({ kind: 'toReference', label: '1', pos: md.indexOf('[^1]') + 4 });
		}
	});

	it('creates a missing definition when jumping from a reference', () => {
		const md = 'See[^x] here.';
		const { a, out } = run(md, 5);
		expect(out).toBe('See[^x] here.\n\n[^x]: ');
		if (a.kind === 'toDefinition') expect(a.pos).toBe(out.length);
	});

	it('inserts before existing definitions when the cursor is after them', () => {
		const md = 'A[^1].\n\n[^1]: one\n\nMore text';
		const { a, out } = run(md, md.length);
		expect(out).toBe('A[^1].\n\n[^1]: one\n\n[^2]: \n\nMore text[^2]');
		if (a.kind === 'insert') {
			expect(out.slice(0, a.cursor).endsWith('[^2]: ')).toBe(true);
			expect(out.slice(0, a.refEnd).endsWith('More text[^2]')).toBe(true);
		}
	});

	it('ignores footnote syntax in code', () => {
		const md = '```\n[^1]: not a def\n```\nText';
		expect(scanFootnotes(md).defs).toEqual([]);
	});
});
