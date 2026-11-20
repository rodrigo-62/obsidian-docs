// Reading view support (SPEC §5.2, phase 6): highlight commented text in the
// rendered HTML. Obsidian drops HTML comments when rendering, so the anchored
// text is found by matching (core/readingMatch). Clicking a highlight shows the
// thread in the Comments sidebar.

import type { MarkdownPostProcessorContext } from 'obsidian';
import { inlineCommentStore, type DocComments } from '../core/commentStore';
import { lineStarts } from '../core/mdScan';
import { findRendered, occurrenceIndex } from '../core/readingMatch';

const cache = new Map<string, { md: string; doc: DocComments }>();

function parse(path: string, md: string): DocComments {
	const hit = cache.get(path);
	if (hit && hit.md === md) return hit.doc;
	const doc = inlineCommentStore.read(md);
	cache.set(path, { md, doc });
	if (cache.size > 50) cache.delete(cache.keys().next().value as string);
	return doc;
}

function textNodes(root: HTMLElement): Text[] {
	const out: Text[] = [];
	const walker = activeDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (n) => ((n.parentElement?.closest('.frontmatter, .frontmatter-container, .footnotes, sup.footnote-ref') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
	});
	for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
	return out;
}

/** Wrap rendered text [start, end) of `root` (offsets into the concatenated text) in highlight spans. */
function wrap(root: HTMLElement, needle: string, occurrence: number, id: string, extraClass: string): boolean {
	const nodes = textNodes(root);
	let full = '';
	const starts: number[] = [];
	for (const n of nodes) {
		starts.push(full.length);
		full += n.data;
	}
	const hit = findRendered(full, needle, occurrence);
	if (!hit) return false;
	const [s, e] = hit;
	nodes.forEach((node, i) => {
		const ns = starts[i]!;
		const ne = ns + node.data.length;
		if (ne <= s || ns >= e) return;
		let target = node;
		const a = Math.max(s, ns) - ns;
		const b = Math.min(e, ne) - ns;
		if (b <= a) return;
		if (a > 0) target = target.splitText(a);
		if (b - a < target.data.length) target.splitText(b - a);
		const span = createSpan();
		span.className = `folio-hl folio-hl-reading ${extraClass}`.trim();
		span.setAttribute('data-folio-id', id);
		target.parentNode?.insertBefore(span, target);
		span.appendChild(target);
	});
	return true;
}

export function makeReadingPostProcessor(showResolved: () => boolean) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const info = ctx.getSectionInfo(el);
		if (!info) return;
		const md = info.text;
		if (!md.includes('<!--c:')) return;
		const doc = parse(ctx.sourcePath, md);
		if (!doc.ok || !doc.anchored.length) return;
		const ls = lineStarts(md);
		const secFrom = ls[info.lineStart] ?? 0;
		const secTo = info.lineEnd + 1 < ls.length ? (ls[info.lineEnd + 1] as number) - 1 : md.length;
		for (const id of doc.anchored) {
			const a = doc.markers.anchors.get(id)!;
			const t = doc.threads[id]!;
			if (t.resolved && !showResolved()) continue;
			const from = Math.max(a.textFrom, secFrom);
			const to = Math.min(a.textTo, secTo);
			if (from >= to) continue;
			const needle = md.slice(from, to);
			const occ = occurrenceIndex(md.slice(secFrom, from), needle);
			wrap(el, needle, occ, id, t.resolved ? 'folio-hl-resolved' : '');
		}
	};
}

export function clearReadingCache(): void {
	cache.clear();
}
