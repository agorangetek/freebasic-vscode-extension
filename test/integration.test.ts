/*
 * End-to-end test of the extension host boundary.
 *
 * Bundles src/extension.ts with esbuild exactly as `npm run build` does, loads
 * the bundle against a minimal mock of the `vscode` API, activates it, and then
 * drives the providers that were registered. This is the only test that would
 * catch a mistake in the vscode glue (wrong kind mapping, a provider registered
 * for the wrong selector, a snippet built as a plain string, ...).
 *
 * Needs esbuild, so it is skipped when devDependencies are not installed.
 */
import assert from 'node:assert/strict';
import { lookupBuiltin } from '../src/service/builtins.ts';

/** The generated data's spelling of a name. */
function builtinName(name: string): string {
	return lookupBuiltin(name)?.name ?? name;
}
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

let esbuild: typeof import('esbuild') | undefined;
try {
	esbuild = require('esbuild');
} catch {
	esbuild = undefined;
}

/* ------------------------------------------------------------------ vscode */

type Provider = Record<string, (...args: any[]) => any>;

const registrations: Record<string, Array<{ selector: string; provider: Provider }>> = {
	completion: [],
	hover: [],
	signature: [],
	symbols: [],
	formatting: [],
	rangeFormatting: [],
};

class TextEdit {
	readonly range: Range;
	readonly newText: string;
	constructor(range: Range, newText: string) {
		this.range = range;
		this.newText = newText;
	}
	static replace(range: Range, newText: string) {
		return new TextEdit(range, newText);
	}
}

/** Edits an active editor received through editor.edit(). */
const appliedEdits: { range: Range; newText: string }[] = [];

const commands = new Map<string, (...args: any[]) => any>();
const settings: Record<string, unknown> = {};
const outputLines: string[] = [];
const infoMessages: string[] = [];

class Position {
	readonly line: number;
	readonly character: number;
	constructor(line: number, character: number) {
		this.line = line;
		this.character = character;
	}
}

class Range {
	readonly start: Position;
	readonly end: Position;
	get isEmpty() {
		return this.start.line === this.end.line && this.start.character === this.end.character;
	}
	constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
		if (typeof a === 'number') {
			this.start = new Position(a, b as number);
			this.end = new Position(c as number, d as number);
		} else {
			this.start = a;
			this.end = b as Position;
		}
	}
}

class Uri {
	readonly fsPath: string;
	private constructor(fsPath: string) {
		this.fsPath = fsPath;
	}
	static file(p: string) {
		return new Uri(p);
	}
	static parse(p: string) {
		return new Uri(p.replace(/^file:\/\//, ''));
	}
	static joinPath(base: Uri, ...parts: string[]) {
		const segments = base.fsPath.split('/').filter(Boolean);
		for (const part of parts) {
			if (part === '..') segments.pop();
			else if (part !== '.') segments.push(part);
		}
		return new Uri('/' + segments.join('/'));
	}
	toString() {
		return `file://${this.fsPath}`;
	}
}

class MarkdownString {
	isTrusted = false;
	readonly value: string;
	constructor(value: string) {
		this.value = value;
	}
}

class SnippetString {
	readonly value: string;
	constructor(value: string) {
		this.value = value;
	}
}

class CompletionItem {
	readonly label: string;
	readonly kind: number;
	detail?: string;
	sortText?: string;
	filterText?: string;
	documentation?: unknown;
	insertText?: unknown;
	constructor(label: string, kind: number) {
		this.label = label;
		this.kind = kind;
	}
}

class Hover {
	readonly contents: unknown;
	readonly range?: Range;
	constructor(contents: unknown, range?: Range) {
		this.contents = contents;
		this.range = range;
	}
}

class ParameterInformation {
	readonly label: string | [number, number];
	readonly documentation?: unknown;
	constructor(label: string | [number, number], documentation?: unknown) {
		this.label = label;
		this.documentation = documentation;
	}
}

class SignatureInformation {
	readonly label: string;
	readonly documentation?: unknown;
	parameters: ParameterInformation[] = [];
	constructor(label: string, documentation?: unknown) {
		this.label = label;
		this.documentation = documentation;
	}
}

class SignatureHelp {
	signatures: SignatureInformation[] = [];
	activeSignature = 0;
	activeParameter = 0;
}

class DocumentSymbol {
	readonly name: string;
	readonly detail: string;
	readonly kind: number;
	readonly range: Range;
	readonly selectionRange: Range;
	constructor(name: string, detail: string, kind: number, range: Range, selectionRange: Range) {
		this.name = name;
		this.detail = detail;
		this.kind = kind;
		this.range = range;
		this.selectionRange = selectionRange;
	}
}

/** Minimal TextDocument over an array of lines, enough for the providers. */
class TextDocument {
	readonly uri: Uri;
	readonly languageId = 'freebasic';
	readonly lines: string[];
	constructor(path: string, lines: string[]) {
		this.uri = Uri.file(path);
		this.lines = lines;
	}
	get lineCount() {
		return this.lines.length;
	}
	getText(range?: Range) {
		if (!range) return this.lines.join('\n');
		if (range.start.line === range.end.line) {
			return this.lines[range.start.line].slice(range.start.character, range.end.character);
		}
		return this.lines.join('\n');
	}
	lineAt(line: number) {
		const text = this.lines[line] ?? '';
		return { text, range: new Range(line, 0, line, text.length), lineNumber: line };
	}
	positionAt(offset: number) {
		let remaining = offset;
		for (let i = 0; i < this.lines.length; i++) {
			const length = this.lines[i].length;
			if (remaining <= length) return new Position(i, remaining);
			remaining -= length + 1;
		}
		const last = this.lines.length - 1;
		return new Position(last, this.lines[last].length);
	}
	getWordRangeAtPosition(position: Position, re: RegExp) {
		const line = this.lines[position.line] ?? '';
		const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
		const scan = new RegExp(re.source, flags);
		let m: RegExpExecArray | null;
		while ((m = scan.exec(line)) !== null) {
			if (position.character >= m.index && position.character <= m.index + m[0].length) {
				return new Range(position.line, m.index, position.line, m.index + m[0].length);
			}
			if (m[0].length === 0) scan.lastIndex++;
		}
		return undefined;
	}
}

const vscodeMock = {
	Position,
	Range,
	Uri,
	MarkdownString,
	SnippetString,
	CompletionItem,
	Hover,
	ParameterInformation,
	SignatureInformation,
	SignatureHelp,
	DocumentSymbol,
	TextEdit,
	CompletionItemKind: {
		Function: 2,
		Method: 1,
		Variable: 5,
		Field: 4,
		Constant: 20,
		Struct: 22,
		Reference: 17,
		Operator: 23,
		Keyword: 13,
	},
	SymbolKind: {
		Function: 11,
		Struct: 22,
		Enum: 9,
		Namespace: 2,
		Constant: 13,
		Variable: 12,
		Key: 19,
	},
	workspace: {
		textDocuments: [] as TextDocument[],
		getConfiguration: () => ({
			get: (key: string, fallback: unknown) =>
				key in settings ? settings[key] : fallback,
		}),
		findFiles: async () => [] as Uri[],
		fs: {
			readFile: async (uri: Uri) => {
				const found = (vscodeMock.workspace.textDocuments as TextDocument[]).find(
					(d) => d.uri.toString() === uri.toString(),
				);
				return new TextEncoder().encode(found?.getText() ?? '');
			},
		},
		onDidOpenTextDocument: () => ({ dispose() {} }),
		onDidChangeTextDocument: () => ({ dispose() {} }),
		onDidCloseTextDocument: () => ({ dispose() {} }),
		onDidChangeConfiguration: () => ({ dispose() {} }),
	},
	window: {
		activeTextEditor: undefined as unknown,
		setStatusBarMessage: () => ({ dispose() {} }),
		showInformationMessage: (message: string) => {
			infoMessages.push(message);
			return Promise.resolve(undefined);
		},
		createOutputChannel: () => ({
			appendLine: (line: string) => outputLines.push(line),
			show: () => {},
			dispose: () => {},
		}),
	},
	commands: {
		registerCommand: (id: string, handler: (...args: any[]) => any) => {
			commands.set(id, handler);
			return { dispose() {} };
		},
	},
	languages: {
		registerCompletionItemProvider: (selector: string, provider: Provider) => {
			registrations.completion.push({ selector, provider });
			return { dispose() {} };
		},
		registerHoverProvider: (selector: string, provider: Provider) => {
			registrations.hover.push({ selector, provider });
			return { dispose() {} };
		},
		registerSignatureHelpProvider: (selector: string, provider: Provider) => {
			registrations.signature.push({ selector, provider });
			return { dispose() {} };
		},
		registerDocumentSymbolProvider: (selector: string, provider: Provider) => {
			registrations.symbols.push({ selector, provider });
			return { dispose() {} };
		},
		registerDocumentFormattingEditProvider: (selector: string, provider: Provider) => {
			registrations.formatting.push({ selector, provider });
			return { dispose() {} };
		},
		registerDocumentRangeFormattingEditProvider: (selector: string, provider: Provider) => {
			registrations.rangeFormatting.push({ selector, provider });
			return { dispose() {} };
		},
	},
};

/* ------------------------------------------------------------------- setup */

const SAMPLE = [
	"' a doc comment",
	'#include "other.bi"',
	'',
	'sub mySub(byval a as integer)',
	'  dim localOnly as integer',
	'end sub',
	'',
	'ScreenRes(640, 480)',
	'print Left("abc", 2)',
	'myS',
	'',
];

const OTHER = ['sub otherProc(byref x as string)', 'end sub'];

const document = new TextDocument('/ws/main.bas', SAMPLE);

const editor = {
	document,
	get selections() {
		return [new Range(0, 0, 0, 0)];
	},
	edit: async (callback: (builder: { replace: (r: Range, t: string) => void }) => void) => {
		callback({ replace: (range: Range, newText: string) => appliedEdits.push({ range, newText }) });
		return true;
	},
};
const otherFile = new TextDocument('/ws/other.bi', OTHER);

let activation: Promise<void> | undefined;

/** Bundle once, install the mock module loader, activate the extension. */
async function loadExtension(): Promise<void> {
	if (!esbuild) return;
	const dir = mkdtempSync(join(tmpdir(), 'fbvs-'));
	const outfile = join(dir, 'extension.cjs');
	await esbuild.build({
		entryPoints: [join(root, 'src/extension.ts')],
		bundle: true,
		outfile,
		platform: 'node',
		format: 'cjs',
		target: 'node18',
		external: ['vscode'],
		logLevel: 'silent',
	});

	const Module = require('node:module') as any;
	const original = Module._load;
	Module._load = function (request: string, ...rest: unknown[]) {
		if (request === 'vscode') return vscodeMock;
		return original.call(this, request, ...rest);
	};

	const bundle = require(outfile) as { activate: (ctx: unknown) => void };
	vscodeMock.workspace.textDocuments.push(document, otherFile);
	vscodeMock.window.activeTextEditor = editor;
	bundle.activate({ subscriptions: [], workspaceState: undefined });
}

function completeAt(line: number, character: number): CompletionItem[] {
	const provider = registrations.completion[0]!.provider;
	return (provider.provideCompletionItems(document, new Position(line, character)) ??
		[]) as CompletionItem[];
}

function labels(items: CompletionItem[]): string[] {
	return items.map((i) => i.label);
}

test('integration: extension host wiring', { skip: !esbuild && 'esbuild not installed' }, async (t) => {
	activation ??= loadExtension();
	await activation;

	await t.test('registers providers for the freebasic language', () => {
		for (const group of Object.values(registrations)) {
			assert.equal(group.length, 1);
			assert.equal(group[0]!.selector, 'freebasic');
		}
		assert.ok(commands.has('freebasic.reindex'));
		assert.ok(commands.has('freebasic.showIndexStats'));
	});

	await t.test('completes built-ins with their conventional casing', () => {
		const items = completeAt(9, 0);
		const screenRes = items.find((i) => i.label === 'ScreenRes');
		assert.ok(screenRes, `expected ScreenRes in ${labels(items).length} items`);
		assert.equal(screenRes.kind, vscodeMock.CompletionItemKind.Function);
		assert.match(screenRes.detail ?? '', /width|height/i);
		// the manual spells it "Screenres"; the examples say otherwise
		assert.match(
			(screenRes.insertText as SnippetString).value,
			/^ScreenRes\(/,
			'manual casing must not leak into the inserted call',
		);
	});

	await t.test('completes built-ins as call snippets', () => {
		const items = completeAt(9, 0);
		const left = items.find((i) => i.label === 'Left');
		assert.ok(left, 'expected Left');
		assert.ok(left.insertText instanceof SnippetString, 'expected a SnippetString');
		const snippet = left.insertText as SnippetString;
		assert.match(snippet.value, /^Left\(\$\{1:/);
	});

	await t.test('completes symbols from the current document', () => {
		const items = completeAt(9, 2); // cursor inside "myS"
		const mine = items.find((i) => i.label === 'mySub');
		assert.ok(mine, `expected mySub in ${labels(items).join(', ')}`);
		assert.equal(mine.kind, vscodeMock.CompletionItemKind.Method);
	});

	await t.test('completes symbols from other workspace files', async () => {
		await commands.get('freebasic.reindex')!();
		const items = completeAt(9, 2);
		assert.ok(
			labels(items).includes('otherProc'),
			`expected otherProc in ${labels(items).join(', ')}`,
		);
		assert.ok(infoMessages.some((m) => /indexed \d+ files/.test(m)));
	});

	await t.test('hovers built-ins with manual documentation', () => {
		const provider = registrations.hover[0]!.provider;
		const hover = provider.provideHover(document, new Position(7, 3));
		assert.ok(hover instanceof Hover);
		const md = hover.contents as MarkdownString;
		assert.match(md.value, /ScreenRes/);
		assert.match(md.value, /Initializes a graphics mode/);
		assert.match(md.value, /function ScreenRes \(/);
		assert.equal(md.isTrusted, false);
	});

	await t.test('signature help tracks the active parameter', () => {
		const provider = registrations.signature[0]!.provider;
		const help = provider.provideSignatureHelp(document, new Position(8, 19));
		assert.ok(help instanceof SignatureHelp);
		const signature = help.signatures[0]!;
		assert.equal(signature.label, 'Left(str, n)');
		// offsets into the label, so the editor highlights the right parameter
		assert.deepEqual(
			signature.parameters.map((p) => p.label),
			[
				[5, 8],
				[10, 11],
			],
		);
		assert.equal(help.activeParameter, 1, 'cursor is past the comma');
		assert.match((signature.documentation as MarkdownString).value, /function Left \(/);
	});

	await t.test('an opener at the start of a statement brings its closer', () => {
		// the user is midway through typing "function" on an empty line
		const doc = new TextDocument('/ws/block.bas', ['fun', '', 'end sub']);
		vscodeMock.workspace.textDocuments.push(doc);
		const provider = registrations.completion[0]!.provider;
		const items = (provider.provideCompletionItems(doc, new Position(0, 3)) ??
			[]) as CompletionItem[];
		const fn = items.find((i) => i.label === 'function');
		assert.ok(fn, 'function is offered');
		assert.ok(fn.insertText instanceof SnippetString);
		assert.equal(
			(fn.insertText as SnippetString).value,
			'function ${1:name}(${2}) as ${3:integer}\n\t$0\nend function',
		);
	});

	await t.test('"end" is followed by the block terminators', () => {
		const doc = new TextDocument('/ws/end.bas', ['sub main()', '  end ', 'end sub']);
		vscodeMock.workspace.textDocuments.push(doc);
		const provider = registrations.completion[0]!.provider;
		const items = (provider.provideCompletionItems(doc, new Position(1, 6)) ??
			[]) as CompletionItem[];
		const labels = items.map((i) => i.label);
		assert.ok(labels.includes('function'), labels.join(', '));
		assert.ok(labels.includes('sub'));
		assert.ok(labels.includes('select'));
		assert.equal(items.find((i) => i.label === 'function')?.detail, 'end function');
		assert.ok(!labels.includes('dim'), 'ordinary keywords are not offered here');
	});

	await t.test('registers the Format Text command and a formatter', () => {
		assert.ok(commands.has('freebasic.formatText'));
		assert.equal(registrations.formatting[0]?.selector, 'freebasic');
		assert.equal(registrations.rangeFormatting[0]?.selector, 'freebasic');
	});

	await t.test('Format Text capitalizes the document', async () => {
		const doc = new TextDocument('/ws/lower.bas', [
			'sub mySub(byval a as integer)',
			'\tdim v as vec2',
			'\tscreenres 640, 480',
			'end sub',
		]);
		vscodeMock.workspace.textDocuments.push(doc);
		editor.document = doc;
		appliedEdits.length = 0;

		await commands.get('freebasic.formatText')!();

		assert.equal(appliedEdits.length, 1, 'expected one whole-document replacement');
		// the modifier's spelling comes from the generated data (the FreeBASIC
		// examples corpus writes "Byval"), so read it rather than hard-coding it
		const byval = builtinName('byval');
		assert.equal(
			appliedEdits[0]!.newText,
			[
				`sub MySub(${byval} a as integer)`,
				'\tdim v as vec2',
				'\tScreenRes 640, 480',
				'end sub',
			].join('\n'),
		);
	});

	await t.test('a procedure declared in an included file is recognised', async () => {
		// main.bas includes helper.bi; scaleBy is declared there, so its uses in
		// main.bas are the author's procedure and get the same capitalisation
		const helper = new TextDocument('/ws/helper.bi', [
			'function scaleBy(byval v as double) as double',
			'\treturn v',
			'end function',
		]);
		const main = new TextDocument('/ws/uses.bas', [
			'#include once "helper.bi"',
			'sub main()',
			'\tdim d as double = scaleBy(2.0)',
			'end sub',
		]);
		vscodeMock.workspace.textDocuments.push(helper, main);
		editor.document = main;
		appliedEdits.length = 0;

		await commands.get('freebasic.formatText')!();

		assert.equal(appliedEdits.length, 1);
		assert.ok(
			appliedEdits[0]!.newText.includes('\tdim d as double = ScaleBy(2.0)'),
			appliedEdits[0]!.newText,
		);
	});

	await t.test('document symbols list top-level declarations only', () => {
		const provider = registrations.symbols[0]!.provider;
		const symbols = provider.provideDocumentSymbols(document) as DocumentSymbol[];
		const names = symbols.map((s) => s.name);
		assert.ok(names.includes('mySub'), names.join(', '));
		assert.ok(!names.includes('localOnly'), 'locals must not appear in the outline');
	});
});
