// Thread priority (DECISIONS F9.3): optional, normal by default, never breaks older notes.
import { describe, expect, it } from 'vitest';
import { createThread, setPriority, threadPriority, type Thread } from '../src/core/model';
import { inlineCommentStore as store } from '../src/core/commentStore';
import { parseThreads, serializeThreadBlock } from '../src/core/threadStore';
import { exportForLLM } from '../src/core/export';
import { closeMarker as c, openMarker as o } from '../src/core/markers';

const NOW = '2026-11-20T10:00:00Z';

describe('threadPriority / setPriority', () => {
	it('treats a missing or unknown value as normal', () => {
		const t = createThread('q', 'b', NOW);
		expect(threadPriority(t)).toBe('normal');
		expect(threadPriority({ ...t, priority: 'urgent' } as Thread)).toBe('normal');
		expect(threadPriority({ ...t, priority: 3 } as unknown as Thread)).toBe('normal');
	});
	it('stores only non-normal values, before the comments', () => {
		const t = createThread('q', 'b', NOW);
		const high = setPriority(t, 'high');
		expect(high.priority).toBe('high');
		expect(Object.keys(high)).toEqual(['quote', 'created', 'resolved', 'priority', 'comments']);
		const back = setPriority(high, 'normal');
		expect('priority' in back).toBe(false);
		expect(back).toEqual(t);
	});
});

describe('notes and priority', () => {
	const old = `Some ${o('ab12')}text${c('ab12')} here.\n\n${serializeThreadBlock({ ab12: createThread('text', 'An old comment', NOW) })}\n`;

	it('reads notes without priorities as before, and rewrites them unchanged', () => {
		const doc = store.read(old);
		expect(doc.ok).toBe(true);
		expect(threadPriority(doc.threads.ab12!)).toBe('normal');
		let out = old;
		for (const ch of [...store.write(old, doc.threads, doc)].sort((a, b) => b.from - a.from)) out = out.slice(0, ch.from) + ch.insert + out.slice(ch.to);
		expect(out).toBe(old);
	});
	it('creates a thread with a priority', () => {
		const md = 'Alpha beta gamma.\n';
		const res = store.create(md, 6, 10, 'Look', undefined, NOW, 'critical');
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		let out = md;
		for (const ch of [...res.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, ch.from) + ch.insert + out.slice(ch.to);
		expect(store.read(out).threads[res.id]!.priority).toBe('critical');
		expect(out).toContain('"priority": "critical"');
	});
	it('keeps an unknown priority value through other edits (e.g. from a newer version)', () => {
		const t = { ...createThread('text', 'x', NOW), priority: 'someday' } as Thread;
		const md = `A ${o('ab12')}text${c('ab12')}\n\n${serializeThreadBlock({ ab12: t })}\n`;
		const parsed = parseThreads(md);
		expect(parsed.ok && parsed.threads.ab12!.priority).toBe('someday');
	});
	it('appears in Copy for LLM only when set', () => {
		const plain = exportForLLM(old, store.read(old).threads, { title: 'n' }).text;
		expect(plain).not.toContain('priority');
		const md = old.replace('"resolved": false,', '"resolved": false,\n    "priority": "high",');
		const out = exportForLLM(md, store.read(md).threads, { title: 'n' }).text;
		expect(out).toContain('<thread id="c1" status="open" priority="high"');
		expect(out).toContain('priority is how important the author rated a thread');
	});
});
