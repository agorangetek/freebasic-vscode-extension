/*
 * Completion item construction.  Editor-agnostic: returns plain objects that
 * the VS Code layer (src/extension.ts) converts to vscode.CompletionItem.
 */
import { allBlocks, allBuiltins, builtinMarkdown, isCompletableName } from './builtins.ts';
import { blockBody, blockContinuations, endWords, isDeclarationPrefix } from './blocks.ts';
import { parameterNames, statementContextAt } from './parser.ts';
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

/**
 * Manual categories whose entries are statements.  These are only offered where
 * a statement can start -- mid-expression the list would be mostly noise.
 */
const STATEMENT_CATEGORIES = new Set([
	'2D Drawing Functions',
	'Array Functions',
	'Compiler Switches',
	'Console Functions',
	'Control Flow',
	'Error Handling Functions',
	'File I/O Functions',
	'Modularizing',
	'Preprocessor',
	'Procedures',
	'Screen Functions',
	'Table of Contents',
	'Threading Support Functions',
	'User Defined Types',
	'User Input',
	'Variable Declarations',
]);

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
 *
 * What is offered also depends on where the cursor is in its statement: a
 * statement keyword is useless in the middle of an expression, `as` is always
 * followed by a type, and `end` by the name of a block.
 */
export function buildCompletions(request: CompletionRequest): FbCompletionItem[] {
	const { document, workspaceSymbols = [], position, options, word } = request;
	const items: FbCompletionItem[] = [];
	const seen = new Set<string>();
	const context = statementContextAt(document.text, position, word);

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

	// 4. after "end", only the words that can finish a block are useful
	if (context.kind === 'end') {
		if (!options.keywords) return items;
		for (const [index, name] of endWords(allBlocks()).entries()) {
			push({
				label: name,
				kind: 'keyword',
				detail: `end ${name}`,
				insertText: name,
				isSnippet: false,
				sortText: RANK.keyword + String(index).padStart(2, '0') + name,
			});
		}
		return items;
	}

	// 5. after "as", only types make sense
	if (context.kind === 'as') {
		if (options.keywords) {
			for (const item of allBuiltins()) {
				if (item.category === 'Standard Data Types' && isCompletableName(item.name)) {
					push(builtinToCompletionItem(item, RANK.keyword, false));
				}
			}
		}
		return items;
	}

	const statementStart = context.kind === 'start';
	// a fresh statement, with nothing on the line yet: where a block belongs
	const freshStatement = /^\s*$/.test(context.before);

	// 6. built-in functions are valid in any expression
	if (options.builtins) {
		for (const item of allBuiltins()) {
			if (item.kind === 'function' && isCompletableName(item.name)) {
				push(builtinToCompletionItem(item, RANK.builtin, options.snippets));
			}
		}
	}

	// 7. at the start of a statement, the block openers expand into a whole
	//    skeleton -- that is where "End Function" comes from
	if (options.keywords && freshStatement && !isDeclarationPrefix(context.before)) {
		const blocks = allBlocks();
		for (const block of blocks) {
			const body = options.snippets ? blockBody(block) : undefined;
			push({
				label: block.opener,
				kind: 'keyword',
				detail: body ? `${block.opener} ... ${block.closer}` : block.opener,
				documentation: `Insert a \`${block.opener}\` block, closed with \`${block.closer}\`.`,
				insertText: body ?? block.opener,
				isSnippet: body !== undefined,
				sortText: RANK.keyword + (body ? '0' : '1') + block.opener.toLowerCase(),
			});
		}
		for (const { label, detail } of blockContinuations(blocks)) {
			push({
				label,
				kind: 'keyword',
				detail,
				insertText: label,
				isSnippet: false,
				sortText: RANK.keyword + '2' + label.toLowerCase(),
			});
		}
	}

	// 8. the rest of the language; mid-expression only operators and the like
	if (options.keywords) {
		for (const item of allBuiltins()) {
			if (item.kind === 'function') continue;
			if (!isCompletableName(item.name)) continue;
			if (!statementStart && STATEMENT_CATEGORIES.has(item.category)) continue;
			push(builtinToCompletionItem(item, RANK.keyword, false));
		}
	}

	return items;
}
