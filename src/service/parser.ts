/*
 * A lightweight FreeBASIC scanner.
 *
 * This is deliberately not a full parser: it needs to be fast enough to run on
 * every keystroke and forgiving enough to work on half-typed code.  It blanks
 * out comments and string literals (keeping offsets aligned) and then picks out
 * declarations line by line, tracking which procedure each local belongs to.
 *
 * Good enough for completion/hover/outline; not a substitute for fbc's parser.
 */
import type { FbDocument, FbPosition, FbSymbol, FbSymbolKind } from './types.ts';

/**
 * Replace comments and string literals with spaces, preserving line count and
 * character offsets so callers can map back to the original text.
 */
export function maskSource(text: string): string[] {
	const lines = text.split(/\r\n|\r|\n/);
	const out: string[] = [];
	let inBlockComment = false;

	for (const line of lines) {
		let masked = '';
		let i = 0;

		while (i < line.length) {
			if (inBlockComment) {
				if (line.startsWith("'/", i)) {
					inBlockComment = false;
					masked += '  ';
					i += 2;
				} else {
					masked += ' ';
					i++;
				}
				continue;
			}

			if (line.startsWith("/'", i)) {
				inBlockComment = true;
				masked += '  ';
				i += 2;
				continue;
			}

			// string literal (Facebook doubles quotes to escape them)
			if (line[i] === '"') {
				masked += ' ';
				i++;
				while (i < line.length) {
					if (line[i] === '"') {
						if (line[i + 1] === '"') {
							masked += '  ';
							i += 2;
							continue;
						}
						masked += ' ';
						i++;
						break;
					}
					masked += ' ';
					i++;
				}
				continue;
			}

			// line comment: ' ... (REM handled below, at a statement boundary)
			if (line[i] === "'") {
				masked += ' '.repeat(line.length - i);
				break;
			}

			// REM comment, only where a statement can start
			if (
				/^rem\b/i.test(line.slice(i)) &&
				(i === 0 || /[\s:]/.test(line[i - 1]))
			) {
				masked += ' '.repeat(line.length - i);
				break;
			}

			masked += line[i];
			i++;
		}

		out.push(masked);
	}

	return out;
}

const PROC_KEYWORDS = 'sub|function|constructor|destructor|property|operator';

/** END SUB / END FUNCTION / END TYPE / ... closes a scope. */
const END_RE = new RegExp(`^\\s*end\\s+(?:${PROC_KEYWORDS}|type|union|enum|namespace|class)\\b`, 'i');

/** A procedure definition or declaration. */
const PROC_RE = new RegExp(
	`^\\s*(?:(?:public|private|protected)\\s+)?(?:(?:declare|extern)\\s+)?(?:static\\s+)?(?:overload\\s+)?(${PROC_KEYWORDS})\\s+([A-Za-z_]\\w*)`,
	'i',
);

const TYPE_RE = /^\s*(type|union|enum|namespace|class)\s+([A-Za-z_]\w*)/i;
const CONST_PREFIX_RE = /^\s*(?:(?:public|private)\s+)?const\s+(?:shared\s+)?/i;
const DEFINE_RE = /^\s*#define\s+([A-Za-z_]\w*)/i;
const VAR_PREFIX_RE =
	/^\s*(?:(?:public|private)\s+)?(?:dim|static|common|redim|extern|var)\s+(?:shared\s+)?/i;
const LABEL_RE = /^\s*([A-Za-z_]\w*|\d+)\s*:(?!:)/;

/**
 * Words that can be part of a type in a type-first declaration
 * (`dim as const string s`), which is how the type is told apart from a
 * user-defined one (`dim as MyType t`).
 */
const TYPE_WORDS =
	/^(?:const|any|ptr|byte|ubyte|short|ushort|long|ulong|longint|ulongint|integer|uinteger|single|double|boolean|string|wstring|zstring|object|function|sub)\b/i;

/** Split "a, b(1, 2), c = (1, 2)" on the commas that are not inside brackets. */
function splitDeclarators(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of text) {
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		if (ch === ',' && depth <= 0) {
			out.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out;
}

/**
 * The names a `dim`/`static`/`redim`/`var`/`const`/... line declares.
 *
 * One statement can declare several variables (`dim a, b as integer`) and the
 * type may come first (`dim shared as integer counter`), so the declarator list
 * is split before the names are read off, and a leading type is skipped --
 * otherwise `dim as integer x` would be recorded as a variable called "as".
 *
 * `var` infers its type from the initializer, so it has no type to skip and is
 * read like any other declarator list (`var a = 1, b = "x"`).
 */
export function declaredNames(
	line: string,
): { kind: 'const' | 'variable'; names: string[] } | undefined {
	const isConst = /^\s*(?:(?:public|private)\s+)?const\b/i.test(line);
	const prefix = (isConst ? CONST_PREFIX_RE : VAR_PREFIX_RE).exec(line);
	if (!prefix) return undefined;

	let rest = line.slice(prefix[0].length);

	// `dim as integer x`: skip the type, leaving the declarators.
	const typeFirst = /^as\s+/i.exec(rest);
	if (typeFirst) {
		rest = rest.slice(typeFirst[0].length);
		let offset = 0;
		for (;;) {
			const word = /^[A-Za-z_]\w*\s*/.exec(rest.slice(offset));
			if (!word || !TYPE_WORDS.test(word[0])) break;
			offset += word[0].length;
		}
		// a user-defined type name: the first word is the type
		rest = offset > 0 ? rest.slice(offset) : rest.replace(/^[A-Za-z_]\w*\s*/, '');
	}

	const names = splitDeclarators(rest)
		.map((declarator) => /^\s*([A-Za-z_]\w*)/.exec(declarator)?.[1])
		.filter((name): name is string => name !== undefined);

	return { kind: isConst ? 'const' : 'variable', names };
}
/** Finds a real (non-commented) #include directive; matched against masked text. */
const INCLUDE_DIRECTIVE_RE = /#include\s+(?:once\s+)?/gi;
/** Pulls the path out of a directive; matched against the original text, since
 * maskSource blanks quoted strings — including the include path itself. */
const INCLUDE_PATH_RE = /#include\s+(?:once\s+)?["<]([^">]+)[">]/i;
const FIELD_RE = /^\s*([A-Za-z_]\w*)\s+as\s+(.+?)\s*$/i;

/** Comment lines directly above a declaration become its documentation. */
function docAbove(lines: string[], index: number): string | undefined {
	const parts: string[] = [];
	for (let i = index - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (line === '') break;
		if (line.startsWith("''")) {
			parts.unshift(line.replace(/^''\s?/, ''));
			continue;
		}
		if (line.startsWith("'")) {
			parts.unshift(line.replace(/^'\s?/, ''));
			continue;
		}
		break;
	}
	return parts.length > 0 ? parts.join('\n') : undefined;
}

/** Extract "byval x as integer, byref s as string" from a declaration line. */
function paramListOf(sourceLine: string): string | undefined {
	const open = sourceLine.indexOf('(');
	if (open < 0) return undefined;
	let depth = 0;
	for (let i = open; i < sourceLine.length; i++) {
		const ch = sourceLine[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return sourceLine.slice(open + 1, i).trim();
		}
	}
	return sourceLine.slice(open + 1).trim();
}

/** "as integer" at the end of a declaration line. */
function returnTypeOf(sourceLine: string): string | undefined {
	const m = sourceLine.match(/\)\s*as\s+(.+?)\s*$/i) ?? sourceLine.match(/\bas\s+([A-Za-z_]\w*)\s*$/i);
	return m ? m[1].trim() : undefined;
}

/** Parameter names from a parameter list, for local completion. */
export function parameterNames(params: string | undefined): string[] {
	if (!params) return [];
	const names: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of params) {
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		if (ch === ',' && depth === 0) {
			names.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	names.push(current);

	return names
		.map((p) => {
			const m = p.trim().match(/^(?:byval|byref|bydesc)?\s*([A-Za-z_]\w*)/i);
			return m ? m[1] : '';
		})
		.filter((n) => n.length > 0);
}

/** Scan one document. */
export function parseDocument(uri: string, text: string): FbDocument {
	const lines = text.split(/\r\n|\r|\n/);
	const masked = maskSource(text);
	const symbols: FbSymbol[] = [];
	const includes: string[] = [];

	// Scope stack: procedures and the type/enum bodies we are inside.
	const procStack: { name: string; kind: FbSymbolKind; symbol: FbSymbol }[] = [];
	const typeStack: { name: string; kind: FbSymbolKind }[] = [];

	const add = (
		name: string,
		kind: FbSymbolKind,
		lineIndex: number,
		detail: string,
		extra: Partial<FbSymbol> = {},
	): FbSymbol => {
		const scope = procStack.length > 0 ? procStack[procStack.length - 1].name : '';
		const symbol: FbSymbol = {
			name,
			kind,
			line: lineIndex,
			detail: detail.trim(),
			scope,
			file: uri,
			doc: docAbove(lines, lineIndex),
			...extra,
		};
		symbols.push(symbol);
		return symbol;
	};

	for (let i = 0; i < masked.length; i++) {
		const line = masked[i];
		const source = lines[i];
		const trimmed = line.trim();
		if (trimmed === '') continue;

		// #include anywhere on the line; locate it in the masked text so commented-out
		// directives are ignored, then read the path from the original source.
		INCLUDE_DIRECTIVE_RE.lastIndex = 0;
		let inc: RegExpExecArray | null;
		while ((inc = INCLUDE_DIRECTIVE_RE.exec(line)) !== null) {
			const found = INCLUDE_PATH_RE.exec(source.slice(inc.index));
			if (found) includes.push(found[1]);
		}

		if (END_RE.test(line)) {
			const endWord = line.trim().split(/\s+/)[1].toLowerCase();
			if (/^(type|union|enum|namespace|class)$/.test(endWord)) {
				typeStack.pop();
			} else {
				// remember where the body ended: a cursor below it is not inside
				// the procedure any more
				const closed = procStack.pop();
				if (closed) closed.symbol.endLine = i;
			}
			continue;
		}

		const proc = line.match(PROC_RE);
		if (proc) {
			const kind = proc[1].toLowerCase() as FbSymbolKind;
			const name = proc[2];
			const params = paramListOf(source);
			const symbol = add(name, kind, i, source, {
				params,
				returns: kind === 'function' ? returnTypeOf(source) : undefined,
			});

			// Only real definitions open a scope; "declare"/"extern" do not.
			const isDeclarationOnly = /^\s*(?:(?:public|private|protected)\s+)?(?:declare|extern)\b/i.test(line);
			const bodyOnSameLine = /\bend\s+(?:sub|function|constructor|destructor|property|operator)\b/i.test(line);
			if (!isDeclarationOnly && !bodyOnSameLine) {
				procStack.push({ name, kind, symbol });
			}
			continue;
		}

		const type = line.match(TYPE_RE);
		if (type) {
			const kind = type[1].toLowerCase() as FbSymbolKind;
			const name = type[2];
			add(name, kind, i, source);
			if (!/\bend\s+(?:type|union|enum|namespace|class)\b/i.test(line)) {
				typeStack.push({ name, kind });
			}
			continue;
		}

		// members of the enclosing enum / type body
		if (typeStack.length > 0) {
			const top = typeStack[typeStack.length - 1];
			if (top.kind === 'enum') {
				const m = trimmed.match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/);
				if (m) {
					add(m[1], 'const', i, source, { detail: source.trim() });
					continue;
				}
			} else if (top.kind === 'type' || top.kind === 'union' || top.kind === 'class') {
				const m = trimmed.match(FIELD_RE);
				if (m && !/^(declare|dim|static|as)\b/i.test(trimmed)) {
					add(m[1], 'variable', i, source, { detail: source.trim() });
					continue;
				}
			}
		}

		const def = line.match(DEFINE_RE);
		if (def) {
			add(def[1], 'define', i, source);
			continue;
		}

		// `dim`, `static`, `redim`, `const`, ...: one statement may declare
		// several names, and the type may come first
		const declaration = declaredNames(line);
		if (declaration) {
			for (const name of declaration.names) {
				add(name, declaration.kind, i, source, { detail: source.trim() });
			}
			continue;
		}

		const label = line.match(LABEL_RE);
		if (label && !/^(case|default)\b/i.test(label[1])) {
			add(label[1], 'label', i, source);
			continue;
		}
	}

	return { uri, text, symbols, includes };
}

/** Where the cursor sits in a statement, which decides what may be offered. */
export type FbStatementKind = 'start' | 'end' | 'as' | 'expression';

export interface FbStatementContext {
	kind: FbStatementKind;
	/** Masked text of the statement, before the word being typed. */
	before: string;
}

/**
 * Classify the position of the cursor inside its statement.
 *
 * `word` is the identifier being typed (as returned by `wordAt`), so it can be
 * excluded: a statement beginning "pri" is still the start of a statement.
 *
 * Only a trailing operator makes it an expression position -- after "declare
 * function" or "dim x" a keyword is still perfectly reasonable, and the caller
 * decides separately whether a statement is fresh enough to scaffold.
 */
export function statementContextAt(
	text: string,
	position: FbPosition,
	word = '',
): FbStatementContext {
	const line = maskSource(text)[position.line] ?? '';
	const upto = line.slice(0, Math.max(0, position.character - word.length));

	// ':' starts a new statement, but '::' is a namespace separator
	const colon = upto.lastIndexOf(':');
	const before = colon >= 0 && upto[colon - 1] !== ':' ? upto.slice(colon + 1) : upto;
	const trimmed = before.trim();

	if (trimmed === '') return { kind: 'start', before };
	if (/\bend$/i.test(trimmed)) return { kind: 'end', before };
	if (/\bas$/i.test(trimmed)) return { kind: 'as', before };

	// an operator or an opening bracket is waiting for an operand
	if (/(?:[=+\-*/\\^&<>(),]|\b(?:and|or|not|mod|xor|eqv|imp|shl|shr|to|step))\s*$/i.test(trimmed)) {
		return { kind: 'expression', before };
	}
	return { kind: 'start', before };
}

/** The identifier at a position, with its range. */
export function wordAt(
	text: string,
	position: FbPosition,
): { word: string; startChar: number; endChar: number; line: string } | undefined {
	const lines = text.split(/\r\n|\r|\n/);
	const line = lines[position.line];
	if (line === undefined) return undefined;

	let start = position.character;
	let end = position.character;
	const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);

	while (start > 0 && isWord(line[start - 1])) start--;
	while (end < line.length && isWord(line[end])) end++;

	const word = line.slice(start, end);
	if (word.length === 0) return undefined;
	return { word, startChar: start, endChar: end, line };
}

/**
 * If the position is inside a call's argument list, return the callee and the
 * zero-based index of the argument being typed (used for signature help).
 */
export function callContextAt(
	text: string,
	position: FbPosition,
): { callee: string; activeParameter: number } | undefined {
	const masked = maskSource(text);
	const line = masked[position.line];
	if (line === undefined) return undefined;

	// walk backwards from the cursor to the unmatched '('
	let depth = 0;
	let lineIndex = position.line;
	let charIndex = position.character;

	for (; lineIndex >= 0; lineIndex--) {
		const current = masked[lineIndex];
		if (charIndex > current.length) charIndex = current.length;
		for (let i = charIndex - 1; i >= 0; i--) {
			const ch = current[i];
			if (ch === ')') depth++;
			else if (ch === '(') {
				if (depth === 0) {
					// callee is the identifier before the '('
					let s = i;
					while (s > 0 && /[A-Za-z0-9_.]/.test(current[s - 1])) s--;
					const callee = current.slice(s, i);
					if (!callee) return undefined;

					// count top-level commas between '(' and the cursor
					let commas = 0;
					let d = 0;
					for (let li = lineIndex; li <= position.line; li++) {
						const l = masked[li];
						const from = li === lineIndex ? i + 1 : 0;
						const to = li === position.line ? position.character : l.length;
						for (let k = from; k < to; k++) {
							const c = l[k];
							if (c === '(' || c === '[') d++;
							else if (c === ')' || c === ']') d--;
							else if (c === ',' && d === 0) commas++;
						}
					}
					return { callee, activeParameter: commas };
				}
				depth--;
			}
		}
		charIndex = lineIndex > 0 ? masked[lineIndex - 1].length : 0;
	}

	return undefined;
}
