import { describe, expect, it } from 'vitest';
import { findOccurrences, hiddenRanges, matchingComments, touchesHidden } from '../src/core/search';
import { parseMarkers, closeMarker as c, openMarker as o } from '../src/core/markers';
import { createThread, type Thread } from '../src/core/model';

describe('hiddenRanges', () => {
	it('lists markers and the block in order, merging neighbours', () => {
		const md = `a ${o('x')}${o('y')}b${c('y')}${c('x')} c`;
		const { markers } = parseMarkers(md);
		const h = hiddenRanges(markers, { from: 100, to: 120 });
		expect(h[0]).toEqual({ from: 2, to: 2 + o('x').length + o('y').length });
		expect(h[h.length - 1]).toEqual({ from: 100, to: 120 });
		expect(h.length).toBe(3);
	});
	it('ignores an empty or missing block', () => {
		expect(hiddenRanges([], null)).toEqual([]);
		expect(hiddenRanges([], { from: 5, to: 5 })).toEqual([]);
	});
});

describe('touchesHidden', () => {
	const h = [
		{ from: 10, to: 20 },
		{ from: 30, to: 40 },
	];
	it('detects overlap but not mere contact', () => {
		expect(touchesHidden(h, 0, 10)).toBe(false);
		expect(touchesHidden(h, 20, 30)).toBe(false);
		expect(touchesHidden(h, 5, 11)).toBe(true);
		expect(touchesHidden(h, 19, 25)).toBe(true);
		expect(touchesHidden(h, 32, 35)).toBe(true);
		expect(touchesHidden(h, 41, 45)).toBe(false);
		expect(touchesHidden(h, 0, 100)).toBe(true);
	});
	it('treats an insertion as hidden only strictly inside a range', () => {
		expect(touchesHidden(h, 10, 10)).toBe(false);
		expect(touchesHidden(h, 15, 15)).toBe(true);
		expect(touchesHidden(h, 20, 20)).toBe(false);
	});
	it('handles no ranges', () => {
		expect(touchesHidden([], 0, 5)).toBe(false);
	});
});

describe('comment search', () => {
	const t: Thread = createThread('q', 'The **Lighthouse** keeper', '2026-11-20T10:00:00Z');
	t.comments.push({ id: 'a2', parent: 'a1', created: '2026-11-20T11:00:00Z', body: 'no match here' });
	t.comments.push({ id: 'a3', parent: 'a1', created: '2026-11-20T12:00:00Z', body: 'a lighthouse (again)' });

	it('finds comments by body, case-insensitively, as plain text', () => {
		expect(matchingComments(t, 'lighthouse')).toEqual(['a1', 'a3']);
		expect(matchingComments(t, '(again)')).toEqual(['a3']);
		expect(matchingComments(t, '.')).toEqual([]);
		expect(matchingComments(t, '')).toEqual([]);
	});
	it('locates occurrences', () => {
		expect(findOccurrences('Aa aA', 'aa')).toEqual([
			[0, 2],
			[3, 5],
		]);
		expect(findOccurrences('a+b a+b', 'a+b')).toEqual([
			[0, 3],
			[4, 7],
		]);
		expect(findOccurrences('abc', '')).toEqual([]);
	});
});
