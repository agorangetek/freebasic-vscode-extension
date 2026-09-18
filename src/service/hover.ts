/*
 * Hover support: documentation for built-ins and for user symbols.
 */
import { builtinMarkdown, lookupBuiltin } from './builtins.ts';
import { wordAt } from './parser.ts';
import type { FbDocument, FbHover, FbPosition, FbSymbol } from './types.ts';

function symbolMarkdown(symbol: FbSymbol): string {
	const parts: string[] = [];
	parts.push('```freebasic\n' + (symbol.detail || `${symbol.kind} ${symbol.name}`) + '\n```');
	if (symbol.doc) parts.push(symbol.doc);
	else if (!symbol.detail) parts.push(`${symbol.kind} **${symbol.name}**`);
	const where = symbol.scope ? `${symbol.scope} (line ${symbol.line + 1})` : `line ${symbol.line + 1}`;
	parts.push(`*Declared in \`${symbol.file.split('/').pop()}\` — ${where}*`);
	return parts.join('\n\n');
}

export function getHover(
	document: FbDocument,
	position: FbPosition,
	customSymbols: readonly FbSymbol[] = [],
): FbHover | undefined {
	const found = wordAt(document.text, position);
	if (!found) return undefined;

	const range = {
		startLine: position.line,
		startChar: found.startChar,
		endLine: position.line,
		endChar: found.endChar,
	};

	// user symbols first: they shadow built-ins
	const lower = found.word.toLowerCase();
	const local =
		document.symbols.find(
			(s) => s.name.toLowerCase() === lower && s.scope !== '' && s.line <= position.line,
		) ??
		document.symbols.find((s) => s.name.toLowerCase() === lower) ??
		customSymbols.find((s) => s.name.toLowerCase() === lower);
	if (local) return { contents: symbolMarkdown(local), range };

	const builtin = lookupBuiltin(found.word);
	if (builtin) return { contents: builtinMarkdown(builtin), range };

	return undefined;
}
