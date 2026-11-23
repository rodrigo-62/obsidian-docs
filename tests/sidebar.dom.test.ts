// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installDomHelpers, MarkdownView } from './mocks/obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { commentExtensions, folioField } from '../src/obsidian/cm';
import { CommentsSidebarView } from '../src/obsidian/sidebarView';
import { closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { createThread } from '../src/core/model';

beforeAll(installDomHelpers);

describe('comments sidebar', () => {
	it('lists the threads of the source note', async () => {
		const doc = `A ${o('a')}one${c('a')} B ${o('b')}two${c('b')}\n\n${serializeThreadBlock({ a: createThread('one', 'first'), b: createThread('two', 'second'), d: createThread('gone', 'detached') })}\n`;
		const cm = new EditorView({ state: EditorState.create({ doc, extensions: [commentExtensions()] }), parent: document.body });
		const md = new MarkdownView();
		md.file = { path: 'n.md', basename: 'n' };
		md.editor = { cm };
		const plugin = { lastMarkdownView: () => md, settings: { showResolved: false }, isTree: () => false } as never;
		const view = new CommentsSidebarView({ app: { workspace: { on: () => ({}) } } } as never, plugin);
		await (view as unknown as { load: () => Promise<void> }).load(); // throws if a field shadows ItemView.titleEl
		const el = (view as unknown as { contentEl: HTMLElement }).contentEl;
		expect(el.querySelector('.folio-sidebar-title')!.textContent).toBe('n');
		expect(el.querySelectorAll('.folio-card').length).toBe(3);
		expect(el.querySelector('.folio-card-quote')!.textContent).toBe('one');
		expect(el.querySelector('.folio-detached-header')!.textContent).toBe('Detached comments (1)');
		cm.destroy();
	});
});

describe('comment search', () => {
	it('highlights an occurrence that spans formatting', async () => {
		const { textRanges } = await import('../src/obsidian/sidebarView');
		const p = document.createElement('p');
		p.innerHTML = 'A light<b>hou</b>se and a Lighthouse';
		const rs = textRanges(p, 'lighthouse');
		expect(rs.map((r) => r.toString())).toEqual(['lighthouse', 'Lighthouse']);
	});

	it('filters threads by comment text and steps through them with Enter', async () => {
		const doc = `A ${o('a')}one${c('a')} B ${o('b')}two${c('b')}\n\n${serializeThreadBlock({ a: createThread('one', 'first note'), b: createThread('two', 'second'), d: createThread('gone', 'a note, detached') })}\n`;
		const cm = new EditorView({ state: EditorState.create({ doc, extensions: [commentExtensions()] }), parent: document.body });
		const md = new MarkdownView();
		md.file = { path: 'n.md', basename: 'n' };
		md.editor = { cm };
		const plugin = { lastMarkdownView: () => md, settings: { showResolved: false }, isTree: () => false } as never;
		const view = new CommentsSidebarView({ app: { workspace: { on: () => ({}) } } } as never, plugin);
		await (view as unknown as { load: () => Promise<void> }).load();
		const el = (view as unknown as { contentEl: HTMLElement }).contentEl;
		const input = el.querySelector<HTMLInputElement>('.folio-sidebar-search input')!;
		const status = () => el.querySelector<HTMLElement>('.folio-sidebar-search-status')!;
		const ids = () => Array.from(el.querySelectorAll('.folio-card')).map((e) => e.getAttribute('data-folio-id'));

		input.value = 'NOTE';
		input.dispatchEvent(new Event('input'));
		expect(ids()).toEqual(['a', 'd']);
		expect(status().textContent).toBe('2 threads');

		const enter = (shift = false) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift }));
		const active = () => cm.state.field(folioField).ui.activeId;
		enter();
		expect(active()).toBe('a');
		expect(cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to)).toBe('one');
		enter();
		expect(active()).toBe('d');
		enter(true);
		expect(active()).toBe('a');

		input.value = 'zzz';
		input.dispatchEvent(new Event('input'));
		expect(ids()).toEqual([]);
		expect(status().textContent).toBe('No comments match');

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(input.value).toBe('');
		expect(ids()).toEqual(['a', 'b', 'd']);
		cm.destroy();
	});
});
