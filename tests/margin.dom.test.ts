// @vitest-environment happy-dom
// Smoke test of the margin + cards against a real CodeMirror EditorView in
// happy-dom (layout values are all zero there; this checks the logic and that
// nothing throws). Obsidian is mocked in tests/mocks/obsidian.ts.
import { beforeAll, describe, expect, it } from 'vitest';


import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { installDomHelpers, Menu, Modal } from './mocks/obsidian';
import { commentExtensions } from '../src/obsidian/cm';
import { folioField, setActive, setDraft } from '../src/obsidian/cm/state';
import { marginContext, marginExtensions, marginPlugin, type MarginContext } from '../src/obsidian/margin/marginView';
import { closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { addReply, createThread } from '../src/core/model';
import { inlineCommentStore as store } from '../src/core/commentStore';
import { createComment, ops, startDraft } from '../src/obsidian/commentOps';

beforeAll(() => {
	installDomHelpers();
	// happy-dom: make the scroller look wide enough for the margin
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1400 });
});

const tick = () => new Promise((r) => setTimeout(r, 30));

function setup(doc: string) {
	const tree = new Map<string, boolean>();
	const ctx: MarginContext = {
		app: {} as never,
		marginWidth: () => 300,
		isMainEditor: () => true,
		sourcePath: () => 'test.md',
		isTree: (_p, id) => tree.get(id) ?? false,
		setTree: (_p, id, t) => void tree.set(id, t),
		openSidebar: () => undefined,
		changed: () => undefined,
	};
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const view = new EditorView({
		state: EditorState.create({ doc, extensions: [commentExtensions([marginContext.of(ctx), ...marginExtensions])] }),
		parent,
	});
	return { view, layer: () => view.scrollDOM.querySelector('.folio-margin') as HTMLElement };
}

function noteWith(text: string, ids: string[]) {
	let threads = Object.fromEntries(ids.map((id) => [id, createThread('q', 'Body of ' + id, '2026-11-20T10:00:00Z')]));
	threads.b = threads.b ? addReply(addReply(threads.b, 'a1', 'second', '2026-11-20T11:00:00Z'), 'a1', 'third, to the first', '2026-11-20T12:00:00Z') : threads.b!;
	threads = Object.fromEntries(Object.entries(threads).filter(([, v]) => v));
	return `${text}\n\n${serializeThreadBlock(threads)}\n`;
}

describe('margin (happy-dom)', () => {
	it('renders one card per thread, plus a detached section', async () => {
		const { view, layer } = setup(noteWith(`Alpha ${o('a')}beta${c('a')} gamma ${o('b')}delta${c('b')}.`, ['a', 'b', 'gone']));
		await tick();
		const cards = layer().querySelectorAll('.folio-card');
		expect(cards.length).toBe(3);
		expect(layer().querySelector('.folio-detached-header')!.textContent).toContain('Detached comments (1)');
		expect(layer().querySelector('[data-folio-id="gone"]')!.classList.contains('is-detached')).toBe(true);
		expect(view.dom.classList.contains('folio-has-margin')).toBe(true);
		view.destroy();
	});

	it('shows parent chips and compacts inactive cards', async () => {
		const { view, layer } = setup(noteWith(`x ${o('b')}delta${c('b')} y`, ['b']));
		await tick();
		const card = () => layer().querySelector('[data-folio-id="b"]') as HTMLElement;
		// inactive: first + last comment, "1 more reply" between
		expect(card().querySelectorAll('.folio-comment').length).toBe(2);
		expect(card().querySelector('.folio-more')!.textContent).toBe('1 more reply');
		view.dispatch({ effects: setActive.of('b') });
		await tick();
		expect(card().classList.contains('is-active')).toBe(true);
		expect(card().querySelectorAll('.folio-comment').length).toBe(3);
		const chip = card().querySelector('.folio-chip')!;
		expect(chip.textContent).toBe('↳ re: “Body of b”');
		// reply box visible when active
		expect((card().querySelector('.folio-card-footer') as HTMLElement).style.display).toBe('');
		view.destroy();
	});

	it('creates a comment through the draft card', async () => {
		const { view, layer } = setup('Hello brave new world');
		view.dispatch({ selection: { anchor: 6, head: 11 } });
		const draft = startDraft(view);
		expect(draft).toEqual({ from: 6, to: 11 });
		await tick();
		const ta = layer().querySelector('.folio-draft textarea') as HTMLTextAreaElement;
		expect(ta).toBeTruthy();
		ta.value = 'A **new** comment';
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
		await tick();
		const st = view.state.field(folioField);
		expect(st.doc.anchored.length).toBe(1);
		const id = st.doc.anchored[0]!;
		expect(st.doc.threads[id]!.comments[0]!.body).toBe('A **new** comment');
		expect(st.ui.activeId).toBe(id);
		expect(layer().querySelector('.folio-draft')).toBeNull();
		expect(layer().querySelector(`[data-folio-id="${id}"]`)).toBeTruthy();
		view.destroy();
	});

	it('cancelling an empty draft leaves nothing behind', async () => {
		const { view, layer } = setup('Hello brave new world');
		view.dispatch({ selection: { anchor: 6, head: 11 } });
		startDraft(view);
		await tick();
		const ta = layer().querySelector('.folio-draft textarea') as HTMLTextAreaElement;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await tick();
		expect(view.state.doc.toString()).toBe('Hello brave new world');
		expect(view.state.field(folioField).ui.draft).toBeNull();
		view.destroy();
	});

	it('replies, resolves, re-opens and deletes through the card', async () => {
		const { view, layer } = setup(noteWith(`Alpha ${o('a')}beta${c('a')} gamma`, ['a']));
		await tick();
		view.dispatch({ effects: setActive.of('a') });
		await tick();
		const card = () => layer().querySelector('[data-folio-id="a"]') as HTMLElement;
		const ta = card().querySelector('.folio-reply-composer textarea') as HTMLTextAreaElement;
		ta.value = 'my reply';
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
		await tick();
		let t = view.state.field(folioField).doc.threads.a!;
		expect(t.comments.map((x) => x.body)).toEqual(['Body of a', 'my reply']);
		expect(t.comments[1]!.parent).toBe('a1');
		// resolve via the ✓ button
		(card().querySelector('.folio-resolve-btn') as HTMLElement).click();
		await tick();
		t = view.state.field(folioField).doc.threads.a!;
		expect(t.resolved).toBe(true);
		expect(layer().querySelector('[data-folio-id="a"]')).toBeNull(); // hidden while show-resolved is off
		ops.resolve(view, 'a', false);
		await tick();
		expect(card()).toBeTruthy();
		// delete the thread from the ⋯ menu (confirmation modal)
		(card().querySelector('[aria-label="More"]') as HTMLElement).click();
		const del = Menu.last!.items.find((i) => i.title === 'Delete thread')!;
		del.cb();
		const modal = Modal.opened.at(-1) as unknown as { contentEl: HTMLElement; onYes: () => void };
		modal.onYes();
		await tick();
		expect(view.state.field(folioField).doc.anchored).toEqual([]);
		expect(view.state.doc.toString()).toBe('Alpha beta gamma\n');
		view.destroy();
	});

	it('switches a thread to tree view and back', async () => {
		const { view, layer } = setup(noteWith(`x ${o('b')}delta${c('b')} y`, ['b']));
		view.dispatch({ effects: setActive.of('b') });
		await tick();
		const card = () => layer().querySelector('[data-folio-id="b"]') as HTMLElement;
		(card().querySelector('.folio-tree-btn') as HTMLElement).click();
		await tick();
		expect(card().classList.contains('is-tree')).toBe(true);
		const rows = Array.from(card().querySelectorAll('.folio-tree-row')) as HTMLElement[];
		expect(rows.map((r) => r.style.getPropertyValue('--folio-indent'))).toEqual(['0', '1', '1']);
		view.destroy();
	});

	it('keeps working with 100 threads', async () => {
		const ids = Array.from({ length: 100 }, (_, i) => 't' + i);
		const text = ids.map((id) => `Para ${o(id)}text ${id}${c(id)} end.`).join('\n\n');
		const t0 = performance.now();
		const { view, layer } = setup(noteWith(text, ids));
		await tick();
		expect(layer().querySelectorAll('.folio-card').length).toBe(100);
		// typing does not rebuild cards
		const first = layer().querySelector('.folio-card');
		view.dispatch({ changes: { from: 0, insert: 'X' }, userEvent: 'input.type' });
		await tick();
		expect(layer().querySelector('.folio-card')).toBe(first);
		expect(performance.now() - t0).toBeLessThan(3000);
		expect(view.plugin(marginPlugin)).toBeTruthy();
		view.destroy();
	});

	it('createComment refuses empty bodies and leaves the text unchanged', () => {
		const { view } = setup('Hello');
		view.dispatch({ effects: setDraft.of({ from: 0, to: 5 }) });
		expect(createComment(view, '   ')).toBeNull();
		expect(view.state.doc.toString()).toBe('Hello');
		expect(store.read(view.state.doc.toString()).anchored).toEqual([]);
		view.destroy();
	});
});
