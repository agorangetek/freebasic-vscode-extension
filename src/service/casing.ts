/*
 * Canonical casing.
 *
 * FreeBASIC is case-insensitive, so rewriting an identifier's case can never
 * change what a program means -- but it makes code read consistently.
 *
 * Three sources decide a spelling:
 *   - the manual's built-ins and the block keywords;
 *   - the author's procedures and types, whose first letter is capitalised
 *     (`drawBox` and every use of it become `DrawBox`) -- the convention the
 *     language's own examples and C#-style FreeBASIC both follow;
 *   - the author's variables, constants and labels, which are left exactly as
 *     written: `i`, `WIDTH` and `myVar` are the author's business.
 *
 * Comments and string literals are left alone too: the spelling of a word
 * inside a message or an Alias string is part of the text, not of the code.
 */
import { FB_BUILTINS } from '../data/fb-builtins.ts';
import { maskSource } from './parser.ts';
import type { FbSymbol } from './types.ts';

export interface CapitalizeResult {
	/** The rewritten text. */
	text: string;
	/** How many identifiers were changed. */
	changes: number;
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Procedures and types read as names, so their first letter is capitalised. */
const CAPITALISED_KINDS =
	/^(?:sub|function|constructor|destructor|property|operator|type|union|enum|class|namespace)$/;

/** `drawBox` -> `DrawBox`; anything already capitalised is unchanged. */
export function capitalizeFirst(name: string): string {
	return name.length > 0 ? name[0]!.toUpperCase() + name.slice(1) : name;
}

/** Lower-cased name -> canonical spelling, built once. */
const BUILTIN_NAMES: ReadonlyMap<string, string> = (() => {
	const map = new Map<string, string>();
	const add = (name: string) => {
		const key = name.toLowerCase();
		if (name.length > 0 && !map.has(key)) map.set(key, name);
	};
	for (const item of FB_BUILTINS.items) add(item.name);
	// "Select Case", "End Function" and friends: each word on its own, since an
	// identifier is what gets rewritten
	for (const block of FB_BUILTINS.blocks) {
		for (const word of `${block.opener} ${block.closer}`.split(/\s+/)) add(word);
	}
	return map;
})();

/**
 * Rewrite every identifier that has a known canonical spelling.
 *
 * `declaredSymbols` (from parseDocument) is what keeps a procedure called
 * `name` from being rewritten to the manual's `Name` statement, and a local
 * `left` from becoming `Left`.
 */
export function capitalizeIdentifiers(
	text: string,
	declaredSymbols: readonly FbSymbol[] = [],
): CapitalizeResult {
	/** Every declared name, so no built-in rule can claim one. */
	const declared = new Set<string>();
	/** Procedures and types, lower-cased -> capitalised spelling. */
	const capitalised = new Map<string, string>();
	for (const symbol of declaredSymbols) {
		const key = symbol.name.toLowerCase();
		if (key.length === 0) continue;
		declared.add(key);
		if (CAPITALISED_KINDS.test(symbol.kind) && !capitalised.has(key)) {
			capitalised.set(key, capitalizeFirst(symbol.name));
		}
	}

	const lookup = (lower: string): string | undefined => {
		const own = capitalised.get(lower);
		if (own) return own;
		if (declared.has(lower)) return undefined;
		return BUILTIN_NAMES.get(lower);
	};

	const maskedLines = maskSource(text);
	// keep the original line separators (\r\n, \r or \n) exactly as they were
	const parts = text.split(/(\r\n|\r|\n)/);
	let changes = 0;
	let line = 0;

	for (let i = 0; i < parts.length; i += 2) {
		const source = parts[i] ?? '';
		const masked = maskedLines[line++] ?? '';
		let out = '';
		let last = 0;
		for (const match of source.matchAll(IDENTIFIER)) {
			const start = match.index;
			// maskSource blanks comments and strings in place, so a differing
			// character means this identifier is not code
			if (masked[start] !== source[start]) continue;

			const replacement = lookup(match[0].toLowerCase());
			if (!replacement || replacement === match[0]) continue;

			out += source.slice(last, start) + replacement;
			last = start + match[0].length;
			changes++;
		}
		parts[i] = out + source.slice(last);
	}

	return { text: parts.join(''), changes };
}
