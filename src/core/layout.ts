// Margin card layout (SPEC §5.2). Pure TypeScript.
//
// Each card wants its top edge level with the top of its anchor. Cards are
// sorted by anchor position and pushed down to avoid overlap. If a card is
// active, it gets exactly its ideal position, and the cards before it are
// pushed *up* (and the ones after it down), as in Google Docs.

export interface CardBox {
	id: string;
	/** Ideal top (anchor top), in px. */
	ideal: number;
	height: number;
	/** Tie-breaker for equal ideals (document order of the anchor start). */
	order?: number;
}

export interface LayoutOptions {
	gap?: number;
	activeId?: string | null;
	/** Cards may not start above this (e.g. 0 = top of the document). */
	minTop?: number;
}

/** Returns the top of every card, keyed by id. */
export function layoutCards(cards: CardBox[], opts: LayoutOptions = {}): Map<string, number> {
	const gap = opts.gap ?? 8;
	const minTop = opts.minTop ?? -Infinity;
	const sorted = cards
		.map((c, i) => ({ ...c, order: c.order ?? i }))
		.sort((a, b) => a.ideal - b.ideal || a.order - b.order);
	const tops = new Array<number>(sorted.length);
	const k = opts.activeId ? sorted.findIndex((c) => c.id === opts.activeId) : -1;

	const forward = (from: number, floor: number) => {
		let cursor = floor;
		for (let i = from; i < sorted.length; i++) {
			const c = sorted[i]!;
			const t = Math.max(c.ideal, cursor);
			tops[i] = t;
			cursor = t + c.height + gap;
		}
	};

	if (k === -1) {
		forward(0, minTop);
	} else {
		const active = sorted[k]!;
		tops[k] = Math.max(active.ideal, minTop);
		// cards after the active one: pushed down
		forward(k + 1, tops[k]! + active.height + gap);
		// cards before it: pushed up
		let ceiling = tops[k]! - gap;
		for (let i = k - 1; i >= 0; i--) {
			const c = sorted[i]!;
			const t = Math.min(c.ideal, ceiling - c.height);
			tops[i] = t;
			ceiling = t - gap;
		}
		// Not enough room above (document start): push the cards down only as much as needed.
		if (sorted.length && tops[0]! < minTop) {
			let cursor = minTop;
			for (let i = 0; i < sorted.length; i++) {
				const t = Math.max(tops[i]!, cursor);
				tops[i] = t;
				cursor = t + sorted[i]!.height + gap;
			}
		}
	}
	const out = new Map<string, number>();
	sorted.forEach((c, i) => out.set(c.id, tops[i]!));
	return out;
}
