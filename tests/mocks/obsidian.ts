// Minimal stand-in for the 'obsidian' module, enough to run the margin/card
// glue under happy-dom. Also installs Obsidian's HTMLElement helpers.
import { StateField } from '@codemirror/state';

type ElOpts = { cls?: string | string[]; text?: string; attr?: Record<string, string>; type?: string } | string;

function applyOpts(el: HTMLElement, o?: ElOpts): void {
	if (!o) return;
	if (typeof o === 'string') {
		el.className = o;
		return;
	}
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
	if (o.text !== undefined) el.textContent = o.text;
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
	if (o.type) el.setAttribute('type', o.type);
}

export function installDomHelpers(): void {
	const P = HTMLElement.prototype as unknown as Record<string, unknown>;
	if (P.createDiv) return;
	P.createEl = function (this: HTMLElement, tag: string, o?: ElOpts) {
		const el = document.createElement(tag);
		applyOpts(el, o);
		this.appendChild(el);
		return el;
	};
	P.createDiv = function (this: HTMLElement, o?: ElOpts) {
		return (this as unknown as { createEl: (t: string, o?: ElOpts) => HTMLElement }).createEl('div', o);
	};
	P.createSpan = function (this: HTMLElement, o?: ElOpts) {
		return (this as unknown as { createEl: (t: string, o?: ElOpts) => HTMLElement }).createEl('span', o);
	};
	P.empty = function (this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	P.setText = function (this: HTMLElement, t: string) {
		this.textContent = t;
	};
	P.addClass = function (this: HTMLElement, ...c: string[]) {
		this.classList.add(...c);
	};
	P.removeClass = function (this: HTMLElement, ...c: string[]) {
		this.classList.remove(...c);
	};
	P.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
		this.classList.toggle(c, on);
	};
	P.hasClass = function (this: HTMLElement, c: string) {
		return this.classList.contains(c);
	};
	P.setAttr = function (this: HTMLElement, k: string, v: string) {
		this.setAttribute(k, v);
	};
	P.show = function (this: HTMLElement) {
		this.style.display = '';
	};
	P.hide = function (this: HTMLElement) {
		this.style.display = 'none';
	};
	P.toggle = function (this: HTMLElement, on: boolean) {
		this.style.display = on ? '' : 'none';
	};
	P.isShown = function (this: HTMLElement) {
		return this.style.display !== 'none';
	};
	(globalThis as Record<string, unknown>).createSpan = (o?: ElOpts) => {
		const el = document.createElement('span');
		applyOpts(el, o);
		return el;
	};
	(globalThis as Record<string, unknown>).createDiv = (o?: ElOpts) => {
		const el = document.createElement('div');
		applyOpts(el, o);
		return el;
	};
}

export class Component {
	load(): void {}
	unload(): void {}
	addChild<T>(c: T): T {
		return c;
	}
}

export const MarkdownRenderer = {
	async render(_app: unknown, md: string, el: HTMLElement): Promise<void> {
		el.textContent = md;
	},
};

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute('data-icon', icon);
}

export class Notice {
	static messages: string[] = [];
	constructor(msg: string) {
		Notice.messages.push(msg);
	}
}

export class Menu {
	items: { title: string; cb: () => void }[] = [];
	addItem(fn: (i: MenuItem) => void): this {
		const item = new MenuItem();
		fn(item);
		this.items.push({ title: item.title, cb: item.cb });
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): void {
		Menu.last = this;
	}
	static last: Menu | null = null;
}

class MenuItem {
	title = '';
	cb: () => void = () => undefined;
	setTitle(t: string): this {
		this.title = t;
		return this;
	}
	setIcon(): this {
		return this;
	}
	setWarning(): this {
		return this;
	}
	setSection(): this {
		return this;
	}
	onClick(cb: () => void): this {
		this.cb = cb;
		return this;
	}
}

export class Modal {
	static opened: Modal[] = [];
	contentEl = document.createElement('div');
	modalEl = document.createElement('div');
	constructor(public app: unknown) {}
	setTitle(): this {
		return this;
	}
	open(): void {
		Modal.opened.push(this);
		(this as unknown as { onOpen?: () => void }).onOpen?.();
	}
	close(): void {
		(this as unknown as { onClose?: () => void }).onClose?.();
	}
}

export class Setting {
	constructor(public el: HTMLElement) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	addButton(fn: (b: { setButtonText: (t: string) => unknown; setWarning: () => unknown; setCta: () => unknown; onClick: (cb: () => void) => unknown }) => void): this {
		const b = {
			setButtonText: () => b,
			setWarning: () => b,
			setCta: () => b,
			onClick: (cb: () => void) => {
				(this as unknown as { lastClick: () => void }).lastClick = cb;
				return b;
			},
		};
		fn(b);
		return this;
	}
}

export const editorInfoField = StateField.define<{ file: { path: string } | null }>({
	create: () => ({ file: { path: 'test.md' } }),
	update: (v) => v,
});

export class App {}

export class Scope {
	keys: { mods: string[] | null; key: string | null; fn: () => unknown }[] = [];
	constructor(public parent?: unknown) {}
	register(mods: string[] | null, key: string | null, fn: () => unknown) {
		this.keys.push({ mods, key, fn });
		return {};
	}
}
export class MarkdownView {
	file: { path: string; basename: string } | null = null;
	editor: unknown = null;
}
export class ItemView {
	app: unknown;
	contentEl = document.createElement('div');
	// Like Obsidian: the view header's own elements. Subclasses must not shadow these.
	headerEl: HTMLElement | null = document.createElement('div');
	titleEl: HTMLElement | null = document.createElement('div');
	constructor(public leaf: { app?: unknown }) {
		this.app = leaf.app ?? { workspace: { on: () => ({}) } };
	}
	registerEvent(): void {}
	/** Mirrors what Obsidian does when it opens a view. */
	async load(): Promise<void> {
		(this.titleEl as unknown as { setText: (t: string) => void }).setText((this as unknown as { getDisplayText: () => string }).getDisplayText());
		await (this as unknown as { onOpen: () => Promise<void> }).onOpen();
	}
}
export class Plugin {}
export class PluginSettingTab {}
export class TFile {}
