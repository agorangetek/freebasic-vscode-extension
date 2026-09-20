/*
 * Canonical casing.
 *
 * FreeBASIC is case-insensitive, so rewriting an identifier's case can never
 * change what a program means -- but it makes code read consistently.
 *
 * The rule is one line long: everything the language provides is lower case,
 * and nothing else is touched.
 *
 *   - keywords, statements, built-in functions, datatypes, operators and
 *     preprocessor directives are folded down: `ScreenRes` -> `screenres`,
 *     `Left` -> `left`, `__FB_DARWIN__` -> `__fb_darwin__`;
 *   - the user's own identifiers are the user's business and are left exactly
 *     as written: procedures, types, variables, constants and labels alike
 *     (`drawBox`, `Vec2`, `WIDTH`, `MyLocal` are never rewritten).
 *
 * Comments and string literals are left alone too: the spelling of a word
 * inside a message or an Alias string is part of the text, not of the code.
 */
import { FB_BUILTINS } from '../data/fb-builtins.ts';
import { maskSource, parameterNames } from './parser.ts';
import type { FbSymbol } from './types.ts';

export interface CasingResult {
	/** The rewritten text. */
	text: string;
	/** How many identifiers were changed. */
	changes: number;
}

/**
 * An identifier, or a preprocessor directive with its `#` (`#include`). The
 * `#` has to be part of the match: `include` on its own is an ordinary name a
 * user may well have declared, while `#include` is the language's.
 */
const IDENTIFIER = /#?[A-Za-z_][A-Za-z0-9_]*/g;

/** Every name the language provides, lower-cased, built once. */
const LANGUAGE_NAMES: ReadonlySet<string> = (() => {
	const names = new Set<string>();
	for (const item of FB_BUILTINS.items) names.add(item.name.toLowerCase());
	// the compiler's keyword table also covers the words with no manual page of
	// their own (`ptr`, `then`, `wend`, `once`, `protected`, ...)
	for (const keyword of FB_BUILTINS.keywords) names.add(keyword.toLowerCase());
	// "Select Case", "End Function" and friends: each word on its own, since an
	// identifier is what gets rewritten
	for (const block of FB_BUILTINS.blocks) {
		for (const word of `${block.opener} ${block.closer}`.split(/\s+/)) {
			if (word.length > 0) names.add(word.toLowerCase());
		}
	}
	return names;
})();

/**
 * Fold every name the language provides down to lower case, and leave the
 * user's own identifiers -- procedures, types, variables, constants and
 * labels -- exactly as written.
 *
 * `declaredSymbols` (from parseDocument) is what keeps a local variable called
 * `left`, or a procedure called `name`, out of the rewrite: a name the user
 * declared is theirs, even when the language has a built-in of the same name.
 */
export function lowercaseLanguageNames(
	text: string,
	declaredSymbols: readonly FbSymbol[] = [],
): CasingResult {
	/** Every name the user declared, lower-cased, so no built-in rule claims one. */
	const declared = new Set<string>();
	const add = (name: string) => {
		const key = name.toLowerCase();
		if (key.length > 0) declared.add(key);
	};
	for (const symbol of declaredSymbols) {
		add(symbol.name);
		// a procedure's parameters are the user's names too, even though the
		// parser records them on the procedure rather than as symbols
		for (const parameter of parameterNames(symbol.params)) add(parameter);
	}

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

			const lower = match[0].toLowerCase();
			if (declared.has(lower)) continue;
			if (!LANGUAGE_NAMES.has(lower)) continue;
			if (lower === match[0]) continue;

			out += source.slice(last, start) + lower;
			last = start + match[0].length;
			changes++;
		}
		parts[i] = out + source.slice(last);
	}

	return { text: parts.join(''), changes };
}
