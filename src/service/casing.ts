/*
 * Canonical casing.
 *
 * FreeBASIC is case-insensitive, so rewriting an identifier's case can never
 * change what a program means -- but it makes code read consistently. Every
 * name the extension knows a spelling for (the manual's built-ins, the block
 * keywords and the symbols declared in the document itself) is rewritten to
 * that spelling, and nothing else is touched.
 *
 * Comments and string literals are left alone: the manual's spelling of a word
 * inside a message or an Alias string is the author's business.
 */
import { FB_BUILTINS } from '../data/fb-builtins.ts';
import { maskSource } from './parser.ts';

export interface CapitalizeResult {
	/** The rewritten text. */
	text: string;
	/** How many identifiers were changed. */
	changes: number;
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

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
 * `declaredNames` (from parseDocument) lets a document's own symbols be
 * normalised to the way they were declared; they never override a built-in
 * spelling.
 */
export function capitalizeIdentifiers(
	text: string,
	declaredNames: readonly string[] = [],
): CapitalizeResult {
	let canonical: Map<string, string> | undefined;
	const lookup = (lower: string): string | undefined => {
		// A symbol the document declares is the author's own name, so it wins
		// over a built-in spelled the same way: `function name()` must not be
		// rewritten to the manual's `Name` statement, and `dim left as ...`
		// keeps its spelling rather than becoming `Left`.
		if (declaredNames.length > 0) {
			canonical ??= (() => {
				const map = new Map<string, string>();
				for (const name of declaredNames) {
					const key = name.toLowerCase();
					if (name.length > 0 && !map.has(key)) map.set(key, name);
				}
				return map;
			})();
			const own = canonical.get(lower);
			if (own) return own;
		}
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
