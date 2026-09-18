/*
 * Lookup helpers over the generated built-in data (src/data/fb-builtins.ts,
 * produced from the FreeBASIC manual by tools/gen-data.mjs).
 */
import { FB_BUILTINS } from '../data/fb-builtins.ts';
import type { FbBlock, FbBuiltin } from './types.ts';

/** Case-insensitive lookup by name or title. */
const byName = new Map<string, FbBuiltin>();
for (const item of FB_BUILTINS.items) {
	for (const key of [item.name, item.title]) {
		const lower = key.toLowerCase();
		if (!byName.has(lower)) byName.set(lower, item);
	}
}

export function lookupBuiltin(name: string): FbBuiltin | undefined {
	return byName.get(name.toLowerCase());
}

export function allBuiltins(): readonly FbBuiltin[] {
	return FB_BUILTINS.items;
}

/** Built-ins declared with "declare function ..." (callable in expressions). */
export function builtinFunctions(): readonly FbBuiltin[] {
	return FB_BUILTINS.items.filter((i) => i.kind === 'function');
}

/** Everything that is not a callable function: statements, operators, ... */
export function builtinKeywords(): readonly FbBuiltin[] {
	return FB_BUILTINS.items.filter((i) => i.kind !== 'function');
}

export function builtinSource(): string {
	return FB_BUILTINS.source;
}

export function builtinCount(): number {
	return FB_BUILTINS.count;
}

/** Compound statement blocks, from the manual's terminator list. */
export function allBlocks(): readonly FbBlock[] {
	return FB_BUILTINS.blocks;
}

/** The block that `opener` starts, if any. */
export function blockForOpener(opener: string): FbBlock | undefined {
	const lower = opener.toLowerCase();
	return FB_BUILTINS.blocks.find((b) => b.opener.toLowerCase() === lower);
}

/**
 * Whether a built-in's name can be typed as a token.  A few manual pages exist
 * to document punctuation rather than to name something -- "Operator +",
 * "Operator []", "PRIVATE:" -- and those have no business in a completion
 * list, however useful they are as documentation.
 */
export function isCompletableName(name: string): boolean {
	if (/^operator\b/i.test(name)) return false;
	if (name.startsWith('...')) return false;
	return /^[A-Za-z_#$][A-Za-z0-9_ #]*$/.test(name);
}

/** First signature label, e.g. "Left(str, n)", for compact display. */
export function firstSignature(item: FbBuiltin): string {
	return item.signatures[0]?.label ?? item.name;
}

/** The full "declare function ..." line(s), as a fenced code block. */
export function declarationBlock(text: string): string {
	return '```freebasic\n' + text.replace(/^declare\s+/gim, '') + '\n```';
}

/** Markdown documentation for a built-in. */
export function builtinMarkdown(item: FbBuiltin): string {
	const parts: string[] = [];

	if (item.signatures.length > 0) {
		parts.push(declarationBlock(item.signatures.map((s) => s.text).join('\n')));
	} else if (item.usage && item.usage.length > 0) {
		parts.push(declarationBlock(item.usage.join('\n')));
	}

	if (item.summary) parts.push(item.summary);
	if (item.category) parts.push(`*Category: ${item.category}*`);
	if (item.dialect.length > 0) {
		parts.push(item.dialect.map((d) => `- ${d}`).join('\n'));
	}
	parts.push(`[Manual: ${item.title}](${item.url})`);

	return parts.join('\n\n');
}
