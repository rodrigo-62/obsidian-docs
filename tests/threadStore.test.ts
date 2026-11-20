import { describe, expect, it } from 'vitest';
import {
	applyChanges,
	findThreadBlock,
	parseThreads,
	planThreadWrite,
	serializeThreadBlock,
	serializeThreadJson,
} from '../src/core/threadStore';
import { createThread, type Threads } from '../src/core/model';

const sample = (): Threads => ({
	k3f9: {
		quote: 'Light and Distance',
		created: '2026-11-05T15:41:00Z',
		resolved: false,
		comments: [
			{ id: 'a1', parent: null, created: '2026-11-05T15:41:00Z', body: 'The opening could say more about distance at sea' },
			{ id: 'a2', parent: 'a1', created: '2026-11-13T14:33:00Z', body: '---\nOne idea: start with a ship' },
		],
	},
});

describe('threadStore', () => {
	it('round-trips threads through the block', () => {
		const md = 'Some text\n\n' + serializeThreadBlock(sample()) + '\n';
		const r = parseThreads(md);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.threads).toEqual(sample());
	});

	it('serialises one comment per line with stable key order', () => {
		const json = serializeThreadJson(sample());
		expect(json).toContain('\n      { "id": "a1", "parent": null, "created": "2026-11-05T15:41:00Z", "body": "The opening could say more about distance at sea" },\n');
		expect(json.indexOf('"quote"')).toBeLessThan(json.indexOf('"created"'));
		expect(JSON.parse(json)).toEqual(sample());
	});

	it('escapes --> and --!> so the HTML comment is not closed early, and unescapes on read', () => {
		const t = sample();
		t.k3f9!.comments[0]!.body = 'an arrow --> here and --!> there';
		t.k3f9!.quote = 'quote with --> inside';
		const block = serializeThreadBlock(t);
		const inner = block.slice('<!--folio:threads'.length, block.length - 3);
		expect(inner).not.toContain('-->');
		expect(inner).not.toContain('--!>');
		expect(inner).toContain('--\\u003e');
		const r = parseThreads('x\n\n' + block);
		expect(r.ok && r.threads.k3f9!.comments[0]!.body).toBe('an arrow --> here and --!> there');
		expect(r.ok && r.threads.k3f9!.quote).toBe('quote with --> inside');
	});

	it('handles newlines, quotes, backslashes and unicode in bodies', () => {
		const t = sample();
		t.k3f9!.comments[0]!.body = 'line1\nline2 "q" \\ back ü 🎵 <!-- inner';
		const md = serializeThreadBlock(t);
		const r = parseThreads(md);
		expect(r.ok && r.threads.k3f9!.comments[0]!.body).toBe('line1\nline2 "q" \\ back ü 🎵 <!-- inner');
	});

	it('reports malformed JSON without throwing', () => {
		const md = 'text\n\n<!--folio:threads\n{ "a": \n-->\n';
		const r = parseThreads(md);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.block.from).toBe(6);
	});

	it('returns no block for a note without one', () => {
		expect(parseThreads('just text').ok).toBe(true);
		expect(findThreadBlock('just text')).toBeNull();
	});

	it('ignores a block-like string inside a code block', () => {
		const md = '```\n<!--folio:threads\n{}\n-->\n```\n';
		expect(findThreadBlock(md)).toBeNull();
	});

	it('normalises missing fields leniently', () => {
		const md = '<!--folio:threads\n{"x": {"comments": [{"body": "hi"}]}}\n-->';
		const r = parseThreads(md);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.threads.x!.resolved).toBe(false);
			expect(r.threads.x!.comments[0]).toMatchObject({ id: 'a1', parent: null, body: 'hi' });
		}
	});

	it('preserves unknown fields (forward compatibility)', () => {
		const t = sample();
		(t.k3f9 as Record<string, unknown>).color = 'yellow';
		const r = parseThreads(serializeThreadBlock(t));
		expect(r.ok && (r.threads.k3f9 as Record<string, unknown>).color).toBe('yellow');
	});

	describe('planThreadWrite', () => {
		it('appends a block after one blank line', () => {
			const md = 'Hello world';
			const out = applyChanges(md, planThreadWrite(md, sample()));
			expect(out.startsWith('Hello world\n\n<!--folio:threads\n')).toBe(true);
			expect(out.endsWith('\n-->\n')).toBe(true);
		});

		it('appends correctly when the note ends with newlines', () => {
			for (const md of ['Hello\n', 'Hello\n\n']) {
				const out = applyChanges(md, planThreadWrite(md, sample()));
				expect(out.startsWith('Hello\n\n<!--folio:threads')).toBe(true);
			}
		});

		it('replaces an existing block in place', () => {
			const md = 'Hello\n\n' + serializeThreadBlock(sample()) + '\n';
			const next = { ...sample(), zz: createThread('q', 'b', '2026-01-01T00:00:00Z') };
			const out = applyChanges(md, planThreadWrite(md, next));
			const r = parseThreads(out);
			expect(r.ok && Object.keys(r.threads)).toEqual(['k3f9', 'zz']);
			expect(out.startsWith('Hello\n\n<!--folio:threads')).toBe(true);
		});

		it('restores the blank line before the block', () => {
			const md = 'Hello\ntyped\n' + serializeThreadBlock(sample()) + '\n';
			expect(applyChanges(md, planThreadWrite(md, sample())).startsWith('Hello\ntyped\n\n<!--folio:threads')).toBe(true);
		});

		it('removes the block when no threads remain', () => {
			const md = 'Hello\n\n' + serializeThreadBlock(sample()) + '\n';
			expect(applyChanges(md, planThreadWrite(md, {}))).toBe('Hello\n');
		});

		it('moves the block to the end if text was appended after it', () => {
			const md = 'Hello\n\n' + serializeThreadBlock(sample()) + '\nappended later\n';
			const out = applyChanges(md, planThreadWrite(md, sample()));
			expect(out.startsWith('Hello\n\nappended later\n\n<!--folio:threads')).toBe(true);
			const b = findThreadBlock(out)!;
			expect(b.trailing).toBe(false);
		});

		it('is a no-op for an empty note without threads', () => {
			expect(planThreadWrite('abc', {})).toEqual([]);
		});
	});
});
