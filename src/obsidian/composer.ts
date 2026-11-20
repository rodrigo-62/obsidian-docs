// A small text box for writing a comment: Ctrl/Cmd+Enter saves, Esc cancels.
// Used inside margin cards and in a modal (narrow panes / sidebar mode).

import { App, Modal } from 'obsidian';

export interface ComposerOptions {
	placeholder?: string;
	initial?: string;
	submitLabel?: string;
	autofocus?: boolean;
	onSubmit: (text: string) => void;
	onCancel: () => void;
}

export interface Composer {
	el: HTMLElement;
	textarea: HTMLTextAreaElement;
	focus(): void;
}

export function createComposer(parent: HTMLElement, opts: ComposerOptions): Composer {
	const el = parent.createDiv({ cls: 'folio-composer' });
	const textarea = el.createEl('textarea', { cls: 'folio-composer-input', attr: { rows: '2', placeholder: opts.placeholder ?? 'Comment…' } });
	textarea.value = opts.initial ?? '';
	const actions = el.createDiv({ cls: 'folio-composer-actions' });
	const hint = actions.createSpan({ cls: 'folio-composer-hint', text: 'Ctrl+Enter to save · Esc to cancel' });
	hint.setAttr('aria-hidden', 'true');
	const cancel = actions.createEl('button', { cls: 'folio-btn', text: 'Cancel' });
	const submit = actions.createEl('button', { cls: 'folio-btn mod-cta', text: opts.submitLabel ?? 'Comment' });
	const grow = () => {
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
	};
	const updateState = () => submit.toggleClass('is-disabled', textarea.value.trim() === '');
	textarea.addEventListener('input', () => {
		grow();
		updateState();
	});
	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			if (textarea.value.trim()) opts.onSubmit(textarea.value);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			opts.onCancel();
		}
	});
	submit.addEventListener('click', (e) => {
		e.preventDefault();
		if (textarea.value.trim()) opts.onSubmit(textarea.value);
	});
	cancel.addEventListener('click', (e) => {
		e.preventDefault();
		opts.onCancel();
	});
	updateState();
	const focus = () => {
		textarea.focus();
		const n = textarea.value.length;
		textarea.setSelectionRange(n, n);
		grow();
	};
	if (opts.autofocus) window.setTimeout(focus, 0);
	return { el, textarea, focus };
}

/** Modal version of the composer. */
export class ComposerModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private titleText: string,
		private quote: string,
		private opts: Omit<ComposerOptions, 'autofocus'>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.titleText);
		this.modalEl.addClass('folio-composer-modal');
		if (this.quote) this.contentEl.createDiv({ cls: 'folio-quote', text: this.quote });
		createComposer(this.contentEl, {
			...this.opts,
			autofocus: true,
			onSubmit: (t) => {
				this.submitted = true;
				this.close();
				this.opts.onSubmit(t);
			},
			onCancel: () => this.close(),
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) this.opts.onCancel();
	}
}
