import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineCommentStore as store } from '../src/core/commentStore';
import { addReply, setResolved } from '../src/core/model';
import { applyChanges, findThreadBlock } from '../src/core/threadStore';
import { anchorText, GUARD } from '../src/core/markers';

const vaultSrc = (name: string) => readFileSync(join(__dirname, '..', 'scripts', 'vault-src', name), 'utf8').replaceAll('{ZW}', GUARD);

describe('inlineCommentStore', () => {
	it('creates a comment: markers + thread block in one change set', () => {
		const md = 'Alpha beta gamma';
		const r = store.create(md, 6, 10, 'my comment', undefined, '2026-11-20T10:00:00Z');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const out = applyChanges(md, r.changes);
		const doc = store.read(out);
		expect(doc.anchored).toEqual([r.id]);
		expect(doc.threads[r.id]).toMatchObject({ quote: 'beta', resolved: false });
		expect(doc.threads[r.id]!.comments[0]).toMatchObject({ body: 'my comment', parent: null });
		expect(out.slice(r.textFrom, r.textTo)).toBe('beta');
	});

	it('creates a comment at the very end of a note without a block', () => {
		const md = 'Alpha beta';
		const r = store.create(md, 6, 10, 'end');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const out = applyChanges(md, r.changes);
		expect(out.startsWith(`Alpha <!--c:${r.id}-->beta<!--/c:${r.id}-->\n\n<!--docs:threads`)).toBe(true);
	});

	it('round-trips create → reply → resolve → remove back to the original text', () => {
		const md = 'Para one.\n\nPara two.\n';
		const r = store.create(md, 11, 19, 'first');
		if (!r.ok) throw new Error(r.error);
		let cur = applyChanges(md, r.changes);
		let doc = store.read(cur);
		let t = addReply(doc.threads[r.id]!, 'a1', 'reply');
		t = setResolved(t, true);
		cur = applyChanges(cur, store.write(cur, { ...doc.threads, [r.id]: t }));
		doc = store.read(cur);
		expect(doc.threads[r.id]!.comments.length).toBe(2);
		expect(doc.threads[r.id]!.resolved).toBe(true);
		cur = applyChanges(cur, store.remove(cur, r.id));
		expect(cur).toBe(md);
	});

	it('refreshes cached quotes on write', () => {
		const md = 'Alpha beta gamma';
		const r = store.create(md, 6, 10, 'x');
		if (!r.ok) throw new Error(r.error);
		let cur = applyChanges(md, r.changes);
		cur = cur.replace('beta', 'BETA!');
		cur = applyChanges(cur, store.write(cur, store.read(cur).threads));
		expect(store.read(cur).threads[r.id]!.quote).toBe('BETA!');
	});

	it('refuses to write when the thread block is damaged', () => {
		const md = 'x\n\n<!--docs:threads\n{ broken\n-->\n';
		const doc = store.read(md);
		expect(doc.ok).toBe(false);
		expect(() => store.write(md, {})).toThrow();
		expect(store.create(md, 0, 1, 'b').ok).toBe(false);
		expect(store.repair(md)).toEqual([]);
	});

	it('generates ids that do not clash with existing markers or threads', () => {
		const md = vaultSrc('overlap.md');
		const doc = store.read(md);
		const r = store.create(md, md.indexOf('This note'), md.indexOf('This note') + 9, 'x', doc);
		expect(r.ok && !(r.id in doc.threads)).toBe(true);
	});
});

describe('sample notes', () => {
	it('essay: all threads anchored, in reading order, quotes match', () => {
		const md = vaultSrc('essay.md');
		const doc = store.read(md);
		expect(doc.ok).toBe(true);
		expect(doc.anchored).toEqual(['k3f9', 'v8d2', 'm2p4', 'e7q1', 'q5b0', 'r4n6', 't1w3']);
		expect(doc.detached).toEqual([]);
		for (const id of doc.anchored) {
			expect(anchorText(md, doc.markers.anchors.get(id)!)).toBe(doc.threads[id]!.quote);
		}
		expect(findThreadBlock(md)!.trailing).toBe(false);
	});

	it('overlap note: code markers ignored, lone marker is stray, dt5k and lone are detached', () => {
		const md = vaultSrc('overlap.md');
		const doc = store.read(md);
		expect(doc.ok).toBe(true);
		expect(doc.markers.markers.some((m) => m.id.startsWith('zz'))).toBe(false);
		expect(doc.markers.stray.map((m) => m.id)).toEqual(['lone']);
		expect(doc.detached.sort()).toEqual(['dt5k', 'lone']);
		expect(doc.threads.ov2b!.comments[0]!.body).toContain('--> which');
		for (const id of doc.anchored) {
			expect(anchorText(md, doc.markers.anchors.get(id)!)).toBe(doc.threads[id]!.quote);
		}
	});

	it('repair drops only the lone marker in the overlap note', () => {
		const md = vaultSrc('overlap.md');
		const out = applyChanges(md, store.repair(md));
		expect(out).toBe(md.replace('<!--c:lone-->', ''));
	});
});

describe('performance note', () => {
	it('parses ~13k words / 100 threads quickly', () => {
		const md = readFileSync(join(__dirname, '..', 'test-vault', 'Performance — very long note.md'), 'utf8');
		const t0 = performance.now();
		let doc = store.read(md);
		for (let i = 0; i < 9; i++) doc = store.read(md);
		const ms = (performance.now() - t0) / 10;
		expect(doc.anchored.length).toBe(100);
		expect(ms).toBeLessThan(30);
	});
});
