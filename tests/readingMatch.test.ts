import { describe, expect, it } from 'vitest';
import { findRendered, occurrenceIndex, renderedTextOf, signature } from '../src/core/readingMatch';
import { closeMarker as c, openMarker as o } from '../src/core/markers';

describe('reading view matching', () => {
	it('builds signatures of letters and digits', () => {
		const s = signature('A, b-C 1!');
		expect(s.sig).toBe('abc1');
		expect(s.map).toEqual([0, 3, 5, 7]);
	});

	it('strips markup the renderer hides', () => {
		expect(signature(renderedTextOf(`**Bold** and [[Note|alias]] and [link](u) ${o('x')}x${c('x')}[^1] %%hidden%%`)).sig).toBe('boldandaliasandlinkx');
	});

	it('finds formatted text in rendered output', () => {
		const rendered = 'The question I want to pursue is simple to state: why does what we value seem to require time?';
		const r = findRendered(rendered, 'why does *what we value* seem');
		expect(r && rendered.slice(r[0], r[1])).toBe('why does what we value seem');
	});

	it('handles punctuation and quotes differences', () => {
		const rendered = '“A light that cannot be told apart.” — a harbour saying';
		const r = findRendered(rendered, '"A light that cannot be told apart."');
		expect(r && rendered.slice(r[0], r[1])).toBe('A light that cannot be told apart');
	});

	it('picks the right occurrence', () => {
		const rendered = 'value and value and value';
		const r = findRendered(rendered, 'value', 2);
		expect(r).toEqual([20, 25]);
		expect(occurrenceIndex('value and value and ', 'value')).toBe(2);
	});

	it('falls back to the first occurrence if the count is off', () => {
		expect(findRendered('one value', 'value', 3)).toEqual([4, 9]);
	});

	it('returns null when not found or empty', () => {
		expect(findRendered('abc', 'xyz')).toBeNull();
		expect(findRendered('abc', '**')).toBeNull();
	});
});
