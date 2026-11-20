import { describe, expect, it } from 'vitest';
import { layoutCards } from '../src/core/layout';

const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe('layoutCards', () => {
	it('places cards at their ideal position when there is room', () => {
		expect(obj(layoutCards([{ id: 'a', ideal: 0, height: 50 }, { id: 'b', ideal: 100, height: 50 }]))).toEqual({ a: 0, b: 100 });
	});

	it('pushes overlapping cards down, in anchor order', () => {
		const m = layoutCards(
			[
				{ id: 'b', ideal: 20, height: 50 },
				{ id: 'a', ideal: 10, height: 50 },
				{ id: 'c', ideal: 30, height: 50 },
			],
			{ gap: 10 },
		);
		expect(obj(m)).toEqual({ a: 10, b: 70, c: 130 });
	});

	it('gives the active card its ideal position and pushes earlier cards up', () => {
		const m = layoutCards(
			[
				{ id: 'a', ideal: 100, height: 50 },
				{ id: 'b', ideal: 110, height: 50 },
				{ id: 'c', ideal: 120, height: 50 },
			],
			{ gap: 10, activeId: 'b' },
		);
		expect(obj(m)).toEqual({ a: 50, b: 110, c: 170 });
	});

	it('pushing up stops at minTop and then stacks down', () => {
		const m = layoutCards(
			[
				{ id: 'a', ideal: 0, height: 50 },
				{ id: 'b', ideal: 10, height: 50 },
			],
			{ gap: 10, activeId: 'b', minTop: 0 },
		);
		expect(obj(m)).toEqual({ a: 0, b: 60 });
	});

	it('keeps document order for equal ideals', () => {
		const m = layoutCards(
			[
				{ id: 'x', ideal: 0, height: 10, order: 2 },
				{ id: 'y', ideal: 0, height: 10, order: 1 },
			],
			{ gap: 0 },
		);
		expect(obj(m)).toEqual({ y: 0, x: 10 });
	});

	it('never overlaps (random check)', () => {
		let seed = 7;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		for (let run = 0; run < 50; run++) {
			const cards = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, ideal: Math.floor(rnd() * 2000), height: 20 + Math.floor(rnd() * 120) }));
			const active = rnd() < 0.5 ? cards[Math.floor(rnd() * cards.length)]!.id : null;
			const m = layoutCards(cards, { gap: 8, activeId: active, minTop: 0 });
			const placed = cards.map((c) => ({ ...c, top: m.get(c.id)! })).sort((a, b) => a.top - b.top);
			for (let i = 1; i < placed.length; i++) expect(placed[i]!.top).toBeGreaterThanOrEqual(placed[i - 1]!.top + placed[i - 1]!.height + 8 - 1e-9);
			expect(placed[0]!.top).toBeGreaterThanOrEqual(0);
			if (active && m.get(active)! >= 0) {
				const a = cards.find((c) => c.id === active)!;
				// the active card is at its ideal unless the top of the document got in the way
				const fitsAbove = m.get(active) === a.ideal || placed[0]!.top === 0;
				expect(fitsAbove).toBe(true);
			}
		}
	});
});
