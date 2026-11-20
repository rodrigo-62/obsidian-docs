// Notes written while the plugin was called "Folio" must keep working.
import { describe, expect, it } from 'vitest';
import { applyChanges, findThreadBlock, parseThreads, planThreadWrite, serializeThreadJson } from '../src/core/threadStore';
import { hasLegacyKeys, migrateFrontmatter, readDocSettings } from '../src/core/docSettings';
import { inlineCommentStore as store } from '../src/core/commentStore';
import { exportForLLM, cleanFrontmatter } from '../src/core/export';
import { createThread } from '../src/core/model';

const threads = { a1b2: createThread('x', 'old comment', '2026-11-01T00:00:00Z') };
const legacyNote = `Some <!--c:a1b2-->x<!--/c:a1b2--> text.\n\n<!--folio:threads\n${serializeThreadJson(threads)}\n-->\n`;

describe('legacy (Folio) format', () => {
	it('reads the old thread block', () => {
		const b = findThreadBlock(legacyNote)!;
		expect(b.legacy).toBe(true);
		const r = parseThreads(legacyNote);
		expect(r.ok && r.threads.a1b2!.comments[0]!.body).toBe('old comment');
		expect(store.read(legacyNote).anchored).toEqual(['a1b2']);
	});

	it('the next write upgrades the block to the new opener', () => {
		const out = applyChanges(legacyNote, planThreadWrite(legacyNote, threads));
		expect(out).toContain('<!--docs:threads');
		expect(out).not.toContain('<!--folio:threads');
		expect(findThreadBlock(out)!.legacy).toBeFalsy();
	});

	it('reads old frontmatter keys, new keys win', () => {
		expect(readDocSettings({ folio: true, 'folio-zoom': 150, 'folio-theme': 'dark' })).toMatchObject({ enabled: true, zoom: 150, theme: 'dark' });
		expect(readDocSettings({ folio: true, 'folio-zoom': 150, 'docs-zoom': 90 }).zoom).toBe(90);
	});

	it('migrates frontmatter keys in place', () => {
		const fm: Record<string, unknown> = { folio: true, 'folio-font': 'Tinos', 'docs-zoom': 80, 'folio-zoom': 150, tags: ['x'] };
		expect(hasLegacyKeys(fm)).toBe(true);
		expect(migrateFrontmatter(fm)).toBe(true);
		expect(fm).toEqual({ docs: true, 'docs-font': 'Tinos', 'docs-zoom': 80, tags: ['x'] });
		expect(migrateFrontmatter(fm)).toBe(false);
		expect(hasLegacyKeys(fm)).toBe(false);
	});

	it('export strips both old and new plugin keys and the old block', () => {
		expect(cleanFrontmatter('---\ndocs: true\ndocs-zoom: 1\nfolio-font: x\ntitle: T\n---\n')).toBe('---\ntitle: T\n---\n');
		const { text } = exportForLLM(legacyNote, threads);
		expect(text).not.toContain('folio');
		expect(text).toContain('⟦c1⟧x⟦/c1⟧');
	});
});
