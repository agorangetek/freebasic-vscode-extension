/*
 * VS Code entry point.
 *
 * All the language logic lives in ./service (editor-agnostic, unit-tested);
 * this file only translates between those plain objects and the vscode API.
 */
import * as vscode from 'vscode';
import { builtinCount, builtinSource } from './service/builtins.ts';
import { buildCompletions } from './service/completion.ts';
import { getHover } from './service/hover.ts';
import { FbIndex } from './service/index.ts';
import { getSignatureHelp } from './service/signature.ts';
import type { FbCompletionItem, FbCompletionKind, FbDocument, FbSymbol } from './service/types.ts';

const LANGUAGE = 'freebasic';

let index: FbIndex;
let output: vscode.OutputChannel;

function config() {
	const c = vscode.workspace.getConfiguration('freebasic');
	return {
		enable: c.get<boolean>('completion.enable', true),
		keywords: c.get<boolean>('completion.keywords', true),
		builtins: c.get<boolean>('completion.builtins', true),
		snippets: c.get<boolean>('completion.snippets', true),
		workspace: c.get<boolean>('index.workspace', true),
		maxFiles: c.get<number>('index.maxFiles', 400),
		trace: c.get<string>('trace.server', 'off'),
	};
}

function trace(message: string): void {
	if (config().trace === 'off') return;
	output.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/** Parse a document and add it to the index. */
function indexOf(document: vscode.TextDocument): FbDocument {
	return index.index(document.uri.toString(), document.getText());
}

function toCompletionKind(kind: FbCompletionKind): vscode.CompletionItemKind {
	switch (kind) {
		case 'function':
			return vscode.CompletionItemKind.Function;
		case 'sub':
			return vscode.CompletionItemKind.Method;
		case 'method':
			return vscode.CompletionItemKind.Method;
		case 'variable':
			return vscode.CompletionItemKind.Variable;
		case 'field':
			return vscode.CompletionItemKind.Field;
		case 'constant':
			return vscode.CompletionItemKind.Constant;
		case 'type':
			return vscode.CompletionItemKind.Struct;
		case 'label':
			return vscode.CompletionItemKind.Reference;
		case 'operator':
			return vscode.CompletionItemKind.Operator;
		default:
			return vscode.CompletionItemKind.Keyword;
	}
}

function toCompletionItem(item: FbCompletionItem): vscode.CompletionItem {
	const result = new vscode.CompletionItem(item.label, toCompletionKind(item.kind));
	result.detail = item.detail;
	result.sortText = item.sortText;
	if (item.filterText) result.filterText = item.filterText;

	if (item.isSnippet) {
		result.insertText = new vscode.SnippetString(item.insertText);
	} else {
		result.insertText = item.insertText;
	}

	if (item.documentation) {
		const md = new vscode.MarkdownString(item.documentation);
		md.isTrusted = false;
		result.documentation = md;
	}
	return result;
}

function toSymbolKind(kind: FbSymbol['kind']): vscode.SymbolKind {
	switch (kind) {
		case 'sub':
		case 'function':
		case 'constructor':
		case 'destructor':
		case 'property':
		case 'operator':
			return vscode.SymbolKind.Function;
		case 'type':
		case 'union':
		case 'class':
			return vscode.SymbolKind.Struct;
		case 'enum':
			return vscode.SymbolKind.Enum;
		case 'namespace':
			return vscode.SymbolKind.Namespace;
		case 'const':
		case 'define':
			return vscode.SymbolKind.Constant;
		case 'variable':
			return vscode.SymbolKind.Variable;
		case 'label':
			return vscode.SymbolKind.Key;
		default:
			return vscode.SymbolKind.Variable;
	}
}

/** Index every .bas/.bi file in the workspace, in the background. */
async function indexWorkspace(context: vscode.ExtensionContext): Promise<void> {
	const cfg = config();
	if (!cfg.workspace) return;

	const files = await vscode.workspace.findFiles('**/*.{bas,bi}', '**/node_modules/**', cfg.maxFiles);
	trace(`indexing ${files.length} workspace files`);
	for (const file of files) {
		if (context.workspaceState) {
			/* no-op: keeps the loop cancellable in the future */
		}
		try {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === file.toString());
			if (open) {
				indexOf(open);
				continue;
			}
			const bytes = await vscode.workspace.fs.readFile(file);
			index.index(file.toString(), Buffer.from(bytes).toString('utf8'));
		} catch (error) {
			trace(`failed to index ${file.toString()}: ${String(error)}`);
		}
	}
	trace(`index: ${JSON.stringify(index.stats())}`);
}

export function activate(context: vscode.ExtensionContext): void {
	output = vscode.window.createOutputChannel('FreeBASIC');
	index = new FbIndex(config().maxFiles);
	context.subscriptions.push(output);

	context.subscriptions.push(
		vscode.commands.registerCommand('freebasic.reindex', async () => {
			index.clear();
			for (const doc of vscode.workspace.textDocuments) {
				if (doc.languageId === LANGUAGE) indexOf(doc);
			}
			await indexWorkspace(context);
			void vscode.window.showInformationMessage(
				`FreeBASIC: indexed ${index.stats().files} files, ${index.stats().symbols} symbols.`,
			);
		}),
		vscode.commands.registerCommand('freebasic.showIndexStats', () => {
			const stats = index.stats();
			output.show(true);
			output.appendLine(
				`built-ins: ${builtinCount()} (${builtinSource()}); indexed: ${stats.files} files, ${stats.symbols} symbols`,
			);
		}),
	);

	// keep the index in sync with edits
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (doc.languageId === LANGUAGE) indexOf(doc);
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.languageId === LANGUAGE) indexOf(event.document);
		}),
		vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.languageId === LANGUAGE) index.remove(doc.uri.toString());
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('freebasic')) {
				index = new FbIndex(config().maxFiles);
				void indexWorkspace(context);
			}
		}),
	);

	/* ---------------------------------------------------------- completion */
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			LANGUAGE,
			{
				provideCompletionItems(document, position) {
					const cfg = config();
					if (!cfg.enable) return undefined;

					const parsed = indexOf(document);
					const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
					const word = wordRange ? document.getText(wordRange) : '';

					const items = buildCompletions({
						document: parsed,
						workspaceSymbols: cfg.workspace ? index.symbols(parsed.uri) : [],
						position: { line: position.line, character: position.character },
						word,
						options: { keywords: cfg.keywords, builtins: cfg.builtins, snippets: cfg.snippets },
					});

					trace(`completion at ${position.line}:${position.character} -> ${items.length} items`);
					return items.map(toCompletionItem);
				},
			},
			'.',
			'(',
			',',
		),
	);

	/* --------------------------------------------------------------- hover */
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LANGUAGE, {
			provideHover(document, position) {
				const parsed = indexOf(document);
				const hover = getHover(
					parsed,
					{ line: position.line, character: position.character },
					index.symbols(parsed.uri),
				);
				if (!hover) return undefined;

				const md = new vscode.MarkdownString(hover.contents);
				md.isTrusted = false;
				const range = new vscode.Range(
					hover.range.startLine,
					hover.range.startChar,
					hover.range.endLine,
					hover.range.endChar,
				);
				return new vscode.Hover(md, range);
			},
		}),
	);

	/* ------------------------------------------------------ signature help */
	context.subscriptions.push(
		vscode.languages.registerSignatureHelpProvider(
			LANGUAGE,
			{
				provideSignatureHelp(document, position) {
					const parsed = indexOf(document);
					const info = getSignatureHelp(
						parsed,
						{ line: position.line, character: position.character },
						index.symbols(parsed.uri),
					);
					if (!info) return undefined;

					const signature = new vscode.SignatureInformation(
						info.label,
						info.documentation ? new vscode.MarkdownString(info.documentation) : undefined,
					);
					signature.parameters = info.parameters.map(
						(p) =>
							new vscode.ParameterInformation(
								p.label,
								p.documentation ? new vscode.MarkdownString(p.documentation) : undefined,
							),
					);

					const help = new vscode.SignatureHelp();
					help.signatures = [signature];
					help.activeSignature = 0;
					help.activeParameter = info.activeParameter;
					return help;
				},
			},
			'(',
			',',
		),
	);

	/* ----------------------------------------------------- document outline */
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(LANGUAGE, {
			provideDocumentSymbols(document) {
				const parsed = indexOf(document);
				return parsed.symbols
					.filter((s) => s.scope === '')
					.map((s) => {
						const line = document.lineAt(Math.min(s.line, document.lineCount - 1));
						const symbol = new vscode.DocumentSymbol(
							s.name,
							s.detail,
							toSymbolKind(s.kind),
							line.range,
							line.range,
						);
						return symbol;
					});
			},
		}),
	);

	// index the open documents immediately, the rest in the background
	for (const doc of vscode.workspace.textDocuments) {
		if (doc.languageId === LANGUAGE) indexOf(doc);
	}
	void indexWorkspace(context);

	trace(`activated with ${builtinCount()} built-ins from ${builtinSource()}`);
}

export function deactivate(): void {
	index?.clear();
}
