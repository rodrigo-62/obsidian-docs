// The storage façade (SPEC §5.3: "keep the storage behind a CommentStore
// interface so the format can change later"). The Obsidian/CodeMirror glue
// only talks to this interface; every write is expressed as a list of text
// changes in original-document coordinates, so it can be applied either as an
// editor transaction or through app.vault.process.

import {
	anchorText,
	generateId,
	parseMarkers,
	planAnchorInsertion,
	planAnchorRemoval,
	planRepair,
	type MarkerParse,
} from './markers';
import { createThread, nowIso, orderThreads, setPriority, type Priority, type Threads } from './model';
import { parseThreads, planThreadWrite, type Change, type ThreadBlock } from './threadStore';

export interface DocComments {
	/** False when the thread block exists but can't be parsed: nothing may be written then. */
	ok: boolean;
	error?: string;
	threads: Threads;
	markers: MarkerParse;
	block: ThreadBlock | null;
	/** Anchored thread ids in reading order. */
	anchored: string[];
	/** Threads with no anchor in the text. */
	detached: string[];
}

export type CreateResult = { ok: true; id: string; changes: Change[]; textFrom: number; textTo: number } | { ok: false; error: string };

export interface CommentStore {
	read(md: string): DocComments;
	/** Create a thread on [from, to) with a first comment. */
	create(md: string, from: number, to: number, body: string, doc?: DocComments, now?: string, priority?: Priority): CreateResult;
	/** Write the given thread set (refreshing cached quotes and repairing damaged markers). */
	write(md: string, threads: Threads, doc?: DocComments): Change[];
	/** Delete a thread and its anchor markers. */
	remove(md: string, id: string, doc?: DocComments): Change[];
	/** Only the marker repair changes (strays, unknown ids, empty ranges). */
	repair(md: string, doc?: DocComments): Change[];
}

function read(md: string): DocComments {
	const parsed = parseThreads(md);
	const markers = parseMarkers(md, parsed.block);
	const threads = parsed.ok ? parsed.threads : {};
	const pos = new Map<string, number>();
	for (const a of markers.anchors.values()) if (threads[a.id]) pos.set(a.id, a.textFrom);
	const { anchored, detached } = orderThreads(threads, pos);
	return {
		ok: parsed.ok,
		error: parsed.ok ? undefined : parsed.error,
		threads,
		markers,
		block: parsed.block,
		anchored,
		detached,
	};
}

function withFreshQuotes(md: string, threads: Threads, markers: MarkerParse): Threads {
	const out: Threads = {};
	for (const [id, t] of Object.entries(threads)) {
		const a = markers.anchors.get(id);
		const q = a ? anchorText(md, a) : t.quote;
		out[id] = q !== t.quote && q.trim() !== '' ? { ...t, quote: q } : t;
	}
	return out;
}

function sortChanges(changes: Change[]): Change[] {
	// Stable: equal positions keep their given order (markers before the block).
	return changes.map((c, i) => ({ c, i })).sort((a, b) => a.c.from - b.c.from || a.i - b.i).map((x) => x.c);
}

export const inlineCommentStore: CommentStore = {
	read,

	create(md, from, to, body, doc = read(md), now = nowIso(), priority = 'normal') {
		if (!doc.ok) return { ok: false, error: doc.error ?? 'Thread data is damaged.' };
		const taken = new Set([...Object.keys(doc.threads), ...doc.markers.markers.map((m) => m.id)]);
		const id = generateId(taken);
		const plan = planAnchorInsertion(md, from, to, id, doc.markers);
		if (!plan.ok) return plan;
		const threads = withFreshQuotes(md, { ...doc.threads }, doc.markers);
		threads[id] = setPriority(createThread(plan.quote, body, now), priority);
		const changes = sortChanges([...plan.changes, ...planThreadWrite(md, threads, doc.block)]);
		return { ok: true, id, changes, textFrom: plan.textFrom, textTo: plan.textTo };
	},

	write(md, threads, doc = read(md)) {
		if (!doc.ok) throw new Error(doc.error ?? 'Thread data is damaged.');
		const fresh = withFreshQuotes(md, threads, doc.markers);
		const repair = planRepair(md, new Set(Object.keys(fresh)), doc.markers);
		return sortChanges([...repair, ...planThreadWrite(md, fresh, doc.block)]);
	},

	remove(md, id, doc = read(md)) {
		if (!doc.ok) throw new Error(doc.error ?? 'Thread data is damaged.');
		const threads = { ...doc.threads };
		delete threads[id];
		const removal = planAnchorRemoval(md, [id], doc.markers);
		const fresh = withFreshQuotes(md, threads, doc.markers);
		const repair = planRepair(md, new Set(Object.keys(fresh)), doc.markers).filter(
			(r) => !removal.some((x) => x.from < r.to && r.from < x.to),
		);
		return sortChanges([...removal, ...repair, ...planThreadWrite(md, fresh, doc.block)]);
	},

	repair(md, doc = read(md)) {
		if (!doc.ok) return [];
		return planRepair(md, new Set(Object.keys(doc.threads)), doc.markers);
	},
};
