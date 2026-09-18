/*
 * Completion item construction.  Editor-agnostic: returns plain objects that
 * the VS Code layer (src/extension.ts) converts to vscode.CompletionItem.
 */
import { allBuiltins, builtinMarkdown } from './builtins.ts';
import { parameterNames } from './parser.ts';
import type {
	FbBuiltin,
	FbCompletionItem,
	FbCompletionKind,
	FbCompletionOptions,
	FbDocument,
	FbPosition,
	FbSymbol,
} from './types.ts';

/** Lower sorts first. */
const RANK = {
	local: '0',
	document: '1',
	workspace: '2',
	builtin: '3',
	keyword: '4',
} as const;

function symbolKindToCompletion(kind: FbSymbol['kind']): FbCompletionKind {
	switch (kind) {
		case 'sub':
		case 'constructor':
		case 'destructor':
		case 'property':
			return 'sub';
		case 'function':
		case 'operator':
			return 'function';
		case 'type':
		case 'union':
		case 'enum':
		case 'namespace':
		case 'class':
			return 'type';
		case 'const':
		case 'define':
			return 'constant';
		case 'label':
			return 'label';
		default:
			return 'variable';
	}
}

function symbolDetail(symbol: FbSymbol): string {
	if (symbol.params !== undefined) {
		const suffix = symbol.returns ? ` as ${symbol.returns}` : '';
		return `${symbol.kind} ${symbol.name}(${symbol.params})${suffix}`;
	}
	if (symbol.kind === 'const' || symbol.kind === 'define') return symbol.detail || symbol.name;
	return symbol.detail || `${symbol.kind} ${symbol.name}`;
}

export function symbolToCompletionItem(
	symbol: FbSymbol,
	rank: string,
	allowSnippet = true,
): FbCompletionItem {
	const isCallable = /^(sub|function|constructor|destructor|property|operator)$/.test(symbol.kind);
	const params = parameterNames(symbol.params);

	let insertText = symbol.name;
	let isSnippet = false;
	if (isCallable && params.length > 0 && allowSnippet) {
		const placeholders = params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
		insertText = `${symbol.name}(${placeholders})`;
		isSnippet = true;
	}

	return {
		label: symbol.name,
		kind: symbolKindToCompletion(symbol.kind),
		detail: symbolDetail(symbol),
		documentation: symbol.doc
			? `${symbol.doc}\n\n\`${symbol.file.split('/').pop()}\``
			: symbol.file.split('/').pop(),
		insertText,
		isSnippet,
		sortText: rank + symbol.name.toLowerCase(),
	};
}

export function builtinToCompletionItem(
	item: FbBuiltin,
	rank: string,
	allowSnippet: boolean,
): FbCompletionItem {
	const signature = item.signatures[0];
	const params = signature?.params ?? [];

	let insertText = item.name;
	let isSnippet = false;
	if (allowSnippet && params.length > 0 && item.kind === 'function') {
		const placeholders = params
			.map((p, i) => `\${${i + 1}:${(p.name || 'arg').replace(/[^A-Za-z0-9_]/g, '') || 'arg'}}`)
			.join(', ');
		insertText = `${item.name}(${placeholders})`;
		isSnippet = true;
	}

	return {
		label: item.name,
		kind: item.kind === 'function' ? 'function' : item.kind === 'sub' ? 'sub' : 'keyword',
		detail: signature?.label ?? item.name,
		documentation: builtinMarkdown(item),
		insertText,
		isSnippet,
		sortText: rank + item.name.toLowerCase(),
	};
}

export interface CompletionRequest {
	document: FbDocument;
	workspaceSymbols?: readonly FbSymbol[];
	position: FbPosition;
	word: string;
	options: FbCompletionOptions;
}

/** The procedure whose body contains `position`, if any. */
export function enclosingProcedure(document: FbDocument, position: FbPosition): FbSymbol | undefined {
	let best: FbSymbol | undefined;
	for (const symbol of document.symbols) {
		if (!/^(sub|function|constructor|destructor|property|operator)$/.test(symbol.kind)) continue;
		if (symbol.line > position.line) continue;
		if (!best || symbol.line > best.line) best = symbol;
	}
	return best;
}

/**
 * Build the completion list for a position.  Higher-priority sources come
 * first (locals, then this document, then the workspace, then built-ins), and
 * duplicates are dropped so the best-ranked entry wins.
 */
export function buildCompletions(request: CompletionRequest): FbCompletionItem[] {
	const { document, workspaceSymbols = [], position, options } = request;
	const items: FbCompletionItem[] = [];
	const seen = new Set<string>();

	const push = (item: FbCompletionItem) => {
		const key = item.label.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		items.push(item);
	};

	// 1. locals and parameters of the enclosing procedure
	const proc = enclosingProcedure(document, position);
	if (proc) {
		for (const name of parameterNames(proc.params)) {
			push({
				label: name,
				kind: 'variable',
				detail: `parameter of ${proc.name}`,
				insertText: name,
				isSnippet: false,
				sortText: RANK.local + name.toLowerCase(),
			});
		}
		for (const symbol of document.symbols) {
			if (symbol.scope === proc.name && symbol.name !== proc.name) {
				push(symbolToCompletionItem(symbol, RANK.local, options.snippets));
			}
		}
	}

	// 2. module-level symbols of this document
	for (const symbol of document.symbols) {
		if (symbol.scope === '') push(symbolToCompletionItem(symbol, RANK.document, options.snippets));
	}

	// 3. symbols from other files in the workspace
	for (const symbol of workspaceSymbols) {
		if (symbol.file === document.uri) continue;
		push(symbolToCompletionItem(symbol, RANK.workspace, options.snippets));
	}

	// 4. built-in functions, then the rest of the language
	if (options.builtins) {
		for (const item of allBuiltins()) {
			if (item.kind === 'function') push(builtinToCompletionItem(item, RANK.builtin, options.snippets));
		}
	}
	if (options.keywords) {
		for (const item of allBuiltins()) {
			if (item.kind !== 'function') push(builtinToCompletionItem(item, RANK.keyword, false));
		}
	}

	return items;
}
