/*
 * Tokenization tests for the TextMate grammar.
 *
 * Syntax highlighting is the grammar's whole job: a theme can only colour what
 * the grammar scopes, so a token that matches no rule silently falls back to
 * the editor's default foreground. That is how type names ended up blue in some
 * places and plain grey in others -- "type Vec2" was scoped, but "as Vec2" was
 * not.
 *
 * These tests tokenize real code with the same engine the editor uses and check
 * every position a type name can appear in.
 *
 * Needs vscode-textmate/vscode-oniguruma, so they are skipped when
 * devDependencies are not installed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The oniguruma and textmate packages are CommonJS. */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface OnigLib {
	loadWASM(data: ArrayBuffer): Promise<void>;
	OnigScanner: new (patterns: string[]) => unknown;
	OnigString: new (s: string) => unknown;
}
interface Textmate {
	INITIAL: unknown;
	Registry: new (options: unknown) => { loadGrammar(scope: string): Promise<Grammar> };
	parseRawGrammar(text: string, name: string): unknown;
}
interface Grammar {
	tokenizeLine(
		line: string,
		stack: unknown,
	): { tokens: { startIndex: number; endIndex: number; scopes: string[] }[]; ruleStack: unknown };
}

let onig: OnigLib | undefined;
let vsctm: Textmate | undefined;
try {
	onig = require('vscode-oniguruma') as OnigLib;
	vsctm = require('vscode-textmate') as Textmate;
} catch {
	onig = undefined;
}

interface Token {
	text: string;
	scopes: string[];
}

const TYPE_SCOPE = /(?:^|\.)(?:storage\.type|entity\.name\.type|support\.type)(?:\.|$)/;

const FIXTURE = [
	'type Vec2', //                                             0  declaration
	'\tx as double', //                                         1  type member
	'\tdeclare function scaled(byval f as double) as Vec2', //  2  member prototype
	'end type', //                                              3
	'const MAX = 10', //                                        4  constant, not a type
	'function rotate90(byref v as Vec2, byval n as integer) as Vec2', // 5 params + return
	'\tdim result as Vec2', //                                  6  variable
	'\tdim z as integer = MAX', //                              7  initialiser
	'\tdim w as   Vec2', //                                     8  extra whitespace
	'\tstatic s as single', //                                  9  static local
	'end function', //                                         10
	'Function name() As Double', //                            11 return type of a real body
	'\tReturn 1.0', //                                         12
	'End Function', //                                         13
	'sub takes(byref s as const string, byval p as Vec2)', //   14 const modifier
	'\tdim q as zstring ptr', //                               15 pointer
	'end sub', //                                              16
].join('\n');

async function tokenize(text: string): Promise<Token[][]> {
	await onig!.loadWASM(
		readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer,
	);
	const registry = new vsctm!.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns: string[]) => new onig!.OnigScanner(patterns),
			createOnigString: (s: string) => new onig!.OnigString(s),
		}),
		loadGrammar: async (scopeName: string) =>
			scopeName === 'source.freebasic'
				? vsctm!.parseRawGrammar(
						readFileSync(join(root, 'syntaxes', 'freebasic.tmLanguage.json'), 'utf8'),
						'freebasic.tmLanguage.json',
					)
				: null,
	});
	const grammar = await registry.loadGrammar('source.freebasic');

	const lines = text.split('\n');
	const out: Token[][] = [];
	let stack = vsctm!.INITIAL;
	for (const line of lines) {
		const result = grammar.tokenizeLine(line, stack);
		stack = result.ruleStack;
		out.push(
			result.tokens.map((t) => ({
				text: line.slice(t.startIndex, t.endIndex),
				scopes: t.scopes.filter((s: string) => s !== 'source.freebasic'),
			})),
		);
	}
	return out;
}

/** Every token whose text contains `needle`, as line/token pairs. */
function occurrences(lines: Token[][], needle: string): { line: number; token: Token }[] {
	const found: { line: number; token: Token }[] = [];
	lines.forEach((tokens, line) => {
		for (const token of tokens) {
			if (token.text.includes(needle)) found.push({ line, token });
		}
	});
	return found;
}

const skip = !onig && 'vscode-textmate not installed';

test('every type name is scoped as a type', { skip }, async () => {
	const lines = await tokenize(FIXTURE);

	// names that are a type wherever they appear
	for (const name of ['Vec2', 'double', 'Double', 'single', 'integer', 'string', 'zstring']) {
		const hits = occurrences(lines, name);
		assert.ok(hits.length > 0, `fixture does not use ${name}`);
		for (const { line, token } of hits) {
			assert.ok(
				token.scopes.some((s) => TYPE_SCOPE.test(s)),
				`line ${line + 1}: "${name}" is not scoped as a type (${token.scopes.join(' ') || 'no scope'})`,
			);
		}
	}
});

test('built-in datatypes keep their precise storage.type scope', { skip }, async () => {
	const lines = await tokenize(FIXTURE);
	const expected: Record<string, string> = {
		double: 'storage.type.floating-point.freebasic',
		Double: 'storage.type.floating-point.freebasic',
		single: 'storage.type.floating-point.freebasic',
		integer: 'storage.type.integer.freebasic',
		string: 'storage.type.stringtype.freebasic',
		zstring: 'storage.type.stringtype.freebasic',
	};
	for (const [name, scope] of Object.entries(expected)) {
		for (const { line, token } of occurrences(lines, name)) {
			assert.ok(
				token.scopes.includes(scope),
				`line ${line + 1}: "${name}" should be ${scope}, got ${token.scopes.join(' ') || 'no scope'}`,
			);
		}
	}
	// user-defined types get the entity scope instead
	for (const { line, token } of occurrences(lines, 'Vec2')) {
		assert.ok(
			token.scopes.includes('entity.name.type.freebasic'),
			`line ${line + 1}: Vec2 should be entity.name.type.freebasic`,
		);
	}
});

test('a constant or variable is not mistaken for a type', { skip }, async () => {
	const lines = await tokenize(FIXTURE);
	// MAX is initialised and referenced, never declared as a type
	const hits = occurrences(lines, 'MAX');
	assert.equal(hits.length, 2, 'fixture changed');
	for (const { line, token } of hits) {
		assert.ok(
			!token.scopes.some((s) => TYPE_SCOPE.test(s)),
			`line ${line + 1}: MAX must not be scoped as a type`,
		);
	}
});

test('a const modifier still reads as a modifier', { skip }, async () => {
	const lines = await tokenize(FIXTURE);
	const consts = occurrences(lines, 'const').filter(({ token }) => token.text.trim() === 'const');
	assert.ok(consts.length > 0, 'fixture changed');
	for (const { line, token } of consts) {
		assert.ok(
			!token.scopes.some((s) => TYPE_SCOPE.test(s)),
			`line ${line + 1}: "const" must not be scoped as a type`,
		);
	}
});

test('strings and comments are not scanned for types', { skip }, async () => {
	const lines = await tokenize(['print "as Vec2"', "' as Vec2"].join('\n'));
	const inString = occurrences(lines, 'as Vec2')[0];
	assert.ok(inString, 'fixture changed');
	assert.ok(
		inString.token.scopes.includes('string.quoted.double.unescaped.freebasic'),
		'a string literal must stay a string',
	);
	const inComment = occurrences(lines, 'as Vec2')[1];
	assert.ok(inComment, 'fixture changed');
	assert.ok(
		inComment.token.scopes.includes('comment.line.single-quote.freebasic'),
		'a comment must stay a comment',
	);
});

/* ------------------------------------------------------------------ names */

const NAME_FIXTURE = [
	'function rotate90(byref v as Vec2) as Vec2', // 0 declaration
	'end function', //                              1
	'sub main()', //                                2 sub declaration
	'\tdrawBox 10, 10, 64, 64', //                  3 paren-less call
	'\tscaleBy(v.x, 3.0)', //                       4 call in a statement
	'\tdim scaled as double = scaleBy(v.x, 3.0)', // 5 call inside a declaration
	'\tmySub', //                                  6 bare call
	'\tprint Left("abc", 2)', //                   7 built-in keeps its scope
	'\tcls', //                                    8 built-in keeps its scope
	'end sub', //                                   9
	'type T', //                                   10
	'\tdeclare sub member(byval a as integer)', // 11 member prototype
	'end type', //                                 12
	'declare function proto(byval a as integer) as integer', // 13 prototype
	'top:', //                                     14 label
	'\tx = 1', //                                  15 assignment
	'\tv.x = 2', //                                16 member access
	'\tdim arr(10) as integer', //                 17 array, not a call
].join('\n');

test('procedure names are scoped where they are declared', { skip }, async () => {
	const lines = await tokenize(NAME_FIXTURE);
	for (const [line, name] of [
		[0, 'rotate90'],
		[2, 'main'],
		[11, 'member'],
		[13, 'proto'],
	] as const) {
		const token = lines[line]!.find((t) => t.text.includes(name));
		assert.ok(token, `line ${line + 1}: ${name} vanished`);
		assert.ok(
			token.scopes.includes('entity.name.function.freebasic'),
			`line ${line + 1}: ${name} should be entity.name.function.freebasic, got ${token.scopes.join(' ') || 'no scope'}`,
		);
	}
});

test('calls to unknown procedures are scoped, built-ins keep their own', { skip }, async () => {
	const lines = await tokenize(NAME_FIXTURE);

	// a call the grammar cannot know by name: with and without parentheses
	for (const [line, name] of [
		[3, 'drawBox'],
		[4, 'scaleBy'],
		[5, 'scaleBy'],
		[6, 'mySub'],
	] as const) {
		const token = lines[line]!.find((t) => t.text.includes(name));
		assert.ok(token, `line ${line + 1}: ${name} vanished`);
		assert.ok(
			token.scopes.includes('entity.name.function.freebasic'),
			`line ${line + 1}: ${name} should be a function, got ${token.scopes.join(' ') || 'no scope'}`,
		);
	}

	// built-ins are listed before the catch-all and must not be swallowed by it
	const print = lines[7]!.find((t) => t.text.includes('print'));
	assert.ok(print?.scopes.includes('support.function.console.freebasic'), 'print lost its scope');
	const left = lines[7]!.find((t) => t.text.includes('Left'));
	assert.ok(left?.scopes.includes('support.function.stringlib.freebasic'), 'Left lost its scope');
	const cls = lines[8]!.find((t) => t.text.includes('cls'));
	assert.ok(cls?.scopes.includes('support.function.graphics.freebasic'), 'cls lost its scope');
});

test('a statement head is only a call when it cannot be anything else', { skip }, async () => {
	const lines = await tokenize(NAME_FIXTURE);
	// a label, an assignment and a member access are not calls
	const label = lines[14]!.find((t) => t.text.trim() === 'top');
	assert.ok(!label?.scopes.includes('entity.name.function.freebasic'), 'a label is not a call');
	const x = lines[15]!.find((t) => t.text.trim() === 'x');
	assert.ok(!x?.scopes.includes('entity.name.function.freebasic'), 'an assignment target is not a call');
	const v = lines[16]!.find((t) => t.text.trim() === 'v');
	assert.ok(!v?.scopes.includes('entity.name.function.freebasic'), 'member access is not a call');
	// an array declaration is a variable, not a call to arr()
	const arr = lines[17]!.find((t) => t.text.includes('arr'));
	assert.ok(arr?.scopes.includes('variable.other.freebasic'), 'a declared array is a variable');
	assert.ok(!arr?.scopes.includes('entity.name.function.freebasic'), 'a declared array is not a call');
});

/* --------------------------------------------------------- members and uses */

const MEMBER_FIXTURE = [
	'type Vec2', //                                  0
	'\tx as double', //                             1 field
	'\ty, z as double', //                          2 more fields
	'end type', //                                   3
	'', //                                           4
	'sub Main()', //                                 5
	'\tdim result as vec2', //                      6
	'\tresult.x = -v.y', //                         7 member access
	'\treturn result', //                           8 variable use
	'top:', //                                       9 label
	'\tgoto top', //                                10
	'end sub', //                                    11
].join('\n');

test('fields and member accesses have their own scope', { skip }, async () => {
	const lines = await tokenize(MEMBER_FIXTURE);
	// the fields declared in the type
	for (const [line, name] of [
		[1, 'x'],
		[2, 'y'],
		[2, 'z'],
	] as const) {
		const token = lines[line]!.find((t) => t.text.trim() === name);
		assert.ok(token, `line ${line + 1}: ${name} vanished`);
		assert.ok(
			token.scopes.includes('variable.other.member.freebasic'),
			`line ${line + 1}: field ${name} should be a member, got ${token.scopes.join(' ') || 'no scope'}`,
		);
	}
	// the members reached through a '.'
	const line = lines[7]!;
	for (const name of ['x', 'y']) {
		const token = line.find((t) => t.text.trim() === name);
		assert.ok(token?.scopes.includes('variable.other.member.freebasic'), `${name} should be a member`);
	}
	// ... while what holds them stays a variable
	const result = line.find((t) => t.text.trim() === 'result');
	assert.ok(result?.scopes.includes('variable.other.freebasic'), 'result should be a variable');
	const v = line.find((t) => t.text.trim() === 'v');
	assert.ok(v?.scopes.includes('variable.other.freebasic'), 'v should be a variable');
});

test('a variable is scoped where it is used, not only where declared', { skip }, async () => {
	const lines = await tokenize(MEMBER_FIXTURE);
	const returned = lines[8]!.find((t) => t.text.trim() === 'result');
	assert.ok(
		returned?.scopes.includes('variable.other.freebasic'),
		`a use should be scoped like its declaration, got ${returned?.scopes.join(' ') || 'no scope'}`,
	);
	// the declaration agrees
	const declared = lines[6]!.find((t) => t.text.trim() === 'result');
	assert.ok(declared?.scopes.includes('variable.other.freebasic'));
});

test('the catch-all does not swallow keywords, calls or labels', { skip }, async () => {
	const lines = await tokenize(MEMBER_FIXTURE);
	// a label is a label, not a variable
	const label = lines[9]!.find((t) => t.text.trim() === 'top');
	assert.ok(!label?.scopes.includes('variable.other.freebasic'), 'a label is not a variable');
	// a call keeps the function scope rather than falling through
	const calls = await tokenize('\tscaleBy(1)\n\tdrawBox 1, 2');
	const scaleBy = calls[0]!.find((t) => t.text.trim() === 'scaleBy');
	assert.ok(scaleBy?.scopes.includes('entity.name.function.freebasic'), 'a call stays a call');
	const drawBox = calls[1]!.find((t) => t.text.trim() === 'drawBox');
	assert.ok(drawBox?.scopes.includes('entity.name.function.freebasic'), 'a statement head stays a call');
	// a built-in keeps its own scope
	const builtin = await tokenize('\tdim n as integer');
	const integer = builtin[0]!.find((t) => t.text.trim() === 'integer');
	assert.ok(integer?.scopes.includes('storage.type.integer.freebasic'), 'integer stays a datatype');
});

/*
 * Cast() and its siblings are keywords in the manual and in the compiler's own
 * keyword table, but the operators rule claimed them, so the editor coloured
 * them like "=" and "," -- which the Dark Modern theme renders in the plain
 * foreground, i.e. indistinguishable from an identifier. The data said
 * "keyword", completion showed a keyword icon, and the highlighting disagreed.
 */
const INTRINSIC_FIXTURE = [
	'dim x as double = cast(double, 3)',
	'y = cptr(byte ptr, 0)',
	'z = sizeof(foo)',
	'w = typeof(bar)',
	'p = varptr(q)',
	's = strptr(r)',
	'f = procptr(baz)',
].join('\n');

test('intrinsic operators are keywords, not operators', { skip }, async () => {
	const lines = await tokenize(INTRINSIC_FIXTURE);
	for (const name of ['cast', 'cptr', 'sizeof', 'typeof', 'varptr', 'strptr', 'procptr']) {
		const hits = occurrences(lines, name);
		assert.ok(hits.length > 0, `${name} did not tokenize at all`);
		for (const { token } of hits) {
			const scopes = token.scopes.join(' ');
			assert.ok(
				token.scopes.some((s) => s.startsWith('keyword') && !s.startsWith('keyword.operator')),
				`${name} should be scoped as a keyword, got: ${scopes}`,
			);
		}
	}
});

test('the datatype argument of cast() and cptr() is a type', { skip }, async () => {
	const lines = await tokenize(INTRINSIC_FIXTURE);
	for (const [line, name] of [
		[0, 'double'],
		[1, 'byte'],
	] as const) {
		// "dim x as double = cast(double, 3)" has the name twice: the declared
		// type and the cast argument. Only the latter is scoped by the cast rule.
		const tokens = lines[line]!.filter((t) => t.text === name);
		assert.ok(tokens.length > 0, `${name} was not tokenized on line ${line}`);
		assert.ok(
			tokens.some((t) => t.scopes.includes('storage.type.freebasic')),
			`${name} in a cast should be scoped as a type, got: ${tokens
				.map((t) => t.scopes.join(' '))
				.join(' | ')}`,
		);
	}
});

test('word and symbol operators keep the operator scope', { skip }, async () => {
	const lines = await tokenize('dim a as long = 1 + 2, 3\nb = a mod 2 and a or not a');
	for (const op of ['=', '+', ',', 'mod', 'and', 'or', 'not']) {
		const hits = occurrences(lines, op);
		assert.ok(hits.length > 0, `${op} was not tokenized`);
		for (const { token } of hits) {
			assert.ok(
				token.scopes.includes('keyword.operator.freebasic'),
				`${op} should stay an operator, got: ${token.scopes.join(' ')}`,
			);
		}
	}
});

/* ------------------------------------------------------ block terminators */

/**
 * Every block opener, the keyword that opens it, and the terminator that closes
 * it. A closer is coloured like its opener: `end sub` like `sub`, `end if` like
 * `if`.
 */
const TERMINATORS: readonly [string, string, string][] = [
	['sub foo()', 'sub', 'end sub'],
	['static sub foo()', 'sub', 'end sub'],
	['private sub foo()', 'sub', 'End Sub'],
	['function foo() as integer', 'function', 'end function'],
	['static function foo() as integer', 'function', 'End Function'],
	['constructor t()', 'constructor', 'end constructor'],
	['destructor t()', 'destructor', 'end destructor'],
	['property p() as integer', 'property', 'end property'],
	['operator +(a as T) as T', 'operator', 'end operator'],
	['type T', 'type', 'end type'],
	['union U', 'union', 'end union'],
	['enum E', 'enum', 'end enum'],
	['namespace n', 'namespace', 'end namespace'],
	['scope', 'scope', 'end scope'],
	['with v', 'with', 'end with'],
	['if x then', 'if', 'end if'],
	['select case x', 'select', 'end select'],
	['for i as integer = 1 to 2', 'for', 'next'],
	['do', 'do', 'loop'],
	['while x', 'while', 'wend'],
];

/** The last line's tokens, ignoring the whitespace between them. */
function codeTokens(lines: Token[][]): Token[] {
	return lines[lines.length - 1]!.filter((t) => t.text.trim() !== '');
}

/** The colour family of a token: 'keyword.control', 'keyword.other', ... */
function family(token: Token): string {
	const scope = token.scopes.find((s) => /^(?:keyword|storage|entity|support|variable|constant)\./.test(s));
	assert.ok(scope, `no colour scope on ${JSON.stringify(token.text)}: ${token.scopes.join(' ')}`);
	return scope.split('.').slice(0, 2).join('.');
}

/** The token on the opener line that spells `keyword`. */
function openerToken(lines: Token[][], keyword: string): Token {
	const token = lines[0]!.find((t) => t.text.trim().toLowerCase().startsWith(keyword));
	assert.ok(token, `"${keyword}" not found in ${JSON.stringify(lines[0]!.map((t) => t.text))}`);
	return token;
}

/*
 * "end sub" is one terminator, so it must be one token: when the grammar split
 * it, "end" was keyword.control (pink) and "sub" was keyword.other (blue), and
 * the closing line no longer matched its opening one. That is what happened
 * whenever no procedure body was open -- "static sub foo()" was swallowed by
 * the variable rule, so its "end sub" had no block to close. Which colour a
 * terminator keeps is its opener's, and that is why "end if" -- keyword.control
 * like "if" -- never looked wrong.
 */
test('a terminator is one token, coloured like the keyword that opens the block', { skip }, async () => {
	for (const [opener, keyword, terminator] of TERMINATORS) {
		const wanted = family(openerToken(await tokenize(opener), keyword));
		const tokens = codeTokens(await tokenize([opener, terminator].join('\n')));
		assert.ok(tokens.length > 0, `"${terminator}" vanished`);
		if (terminator.includes(' ')) {
			assert.equal(
				tokens.length,
				1,
				`"${terminator}" split into ${tokens.length} tokens: ${tokens
					.map((t) => `${JSON.stringify(t.text)}=${t.scopes.join(' ')}`)
					.join(', ')}`,
			);
		}
		for (const token of tokens) {
			assert.equal(
				family(token),
				wanted,
				`"${terminator}" should be coloured like "${keyword}" (${wanted}), got ${
					token.scopes.join(' ') || 'no scope'
				}`,
			);
		}
	}
});

test('a terminator keeps that colour with no block open around it', { skip }, async () => {
	// a prototype, a snippet pasted on its own, a half-typed file: there is no
	// block state to close, and the terminator must still read as one token in
	// the colour its opener has. (The loop words -- next/loop/wend -- are not
	// part of this: on their own they are just identifiers, and the grammar
	// treats them as calls, which is what it did before.)
	const ends = TERMINATORS.filter(([, , terminator]) => terminator.toLowerCase().startsWith('end'));
	for (const [opener, keyword, terminator] of ends) {
		const wanted = family(openerToken(await tokenize(opener), keyword));
		const tokens = codeTokens(await tokenize(terminator));
		assert.ok(tokens.length > 0, `"${terminator}" vanished`);
		if (terminator.includes(' ')) {
			assert.equal(
				tokens.length,
				1,
				`standalone "${terminator}" split into ${tokens.length} tokens: ${tokens
					.map((t) => `${JSON.stringify(t.text)}=${t.scopes.join(' ')}`)
					.join(', ')}`,
			);
		}
		for (const token of tokens) {
			assert.equal(
				family(token),
				wanted,
				`standalone "${terminator}" should still be ${wanted}, got ${
					token.scopes.join(' ') || 'no scope'
				}`,
			);
		}
	}

	// the bare statement, with no block word after it
	const bare = codeTokens(await tokenize('end'));
	assert.equal(bare.length, 1, '"end" should be one token');
	assert.equal(family(bare[0]!), 'keyword.control');
});

test('static opens a procedure body when a procedure follows', { skip }, async () => {
	// "static" also opens a variable declaration, and used to win
	const declared = await tokenize('static x as integer');
	const x = declared[0]!.find((t) => t.text.trim() === 'x');
	assert.ok(x?.scopes.includes('variable.other.freebasic'), 'static x is still a variable');

	const lines = await tokenize('static sub foo()\nend sub');
	const sub = lines[0]!.find((t) => t.text.trim() === 'sub');
	assert.ok(
		sub?.scopes.includes('keyword.other.declaration.procedure.body.begin.freebasic'),
		`static sub should open a procedure body, got ${sub?.scopes.join(' ') || 'no scope'}`,
	);
	const stat = lines[0]!.find((t) => t.text.trim() === 'static');
	assert.ok(
		stat?.scopes.includes('storage.modifier.procedure.freebasic'),
		`static should stay a modifier, got ${stat?.scopes.join(' ') || 'no scope'}`,
	);
	assert.equal(codeTokens(lines).length, 1, 'its "end sub" should be one token');
});

/*
 * VS Code chooses which editor.quickSuggestions entry applies to a keystroke by
 * deriving a "standard token type" from the INNERMOST scope of the token at the
 * caret, matching /\b(comment|string|regex|regexp)\b/ (getStandardTokenType in
 * the editor's tokenMetadata).  Strings and comments default to "off", so a code
 * scope that contains one of those words as a whole word stops the suggestion
 * widget from opening while typing.  FreeBASIC's String library used to be
 * scoped support.function.string.freebasic and the String type
 * storage.type.string.freebasic, so typing `str` -- a command -- classified the
 * caret as a string and no list ever appeared.  These tests keep every code
 * scope out of that trap.
 */
const RESERVED_TOKEN_TYPE = /\b(comment|string|regex|regexp)\b/;

/** The scope VS Code reads the quickSuggestions category from. */
function quickSuggestionsCategory(token: Token): string {
	const innermost = token.scopes[token.scopes.length - 1] ?? 'source.freebasic';
	return innermost.match(RESERVED_TOKEN_TYPE)?.[1] ?? 'other';
}

test('no built-in command or keyword is tokenized as a string or a comment', { skip }, async () => {
	const data = JSON.parse(
		readFileSync(join(root, 'src', 'data', 'fb-builtins.json'), 'utf8'),
	) as { items: { name: string }[]; keywords: string[] };
	const names = [...data.items.map((item) => item.name), ...data.keywords];

	const lines = await tokenize(names.join('\n'));
	const offenders: string[] = [];
	lines.forEach((tokens, line) => {
		for (const token of tokens) {
			if (token.text.trim() !== names[line]) continue;
			if (quickSuggestionsCategory(token) !== 'other') {
				offenders.push(`${names[line]} -> ${token.scopes.join(' ')}`);
			}
		}
	});

	assert.deepEqual(
		offenders,
		[],
		`typing these names would suppress the suggestion popup: ${offenders.join(', ')}`,
	);
});

test('a String library command and the String type still pop up suggestions', { skip }, async () => {
	const lines = await tokenize(['dim s as string', '\tprint left("abc", 1)', '\tprint str(1)'].join('\n'));

	for (const name of ['string', 'left', 'str']) {
		const token = occurrences(lines, name).find(({ token }) => token.text.trim() === name)?.token;
		assert.ok(token, `${name} did not tokenize`);
		assert.equal(
			quickSuggestionsCategory(token),
			'other',
			`"${name}" scopes as ${token.scopes.join(' ')}, so the editor would treat it as a string/comment and never pop up`,
		);
	}
});

test('string and comment literals are still classified as such', { skip }, async () => {
	const lines = await tokenize(['print "left"', "' left"].join('\n'));

	const literal = occurrences(lines, 'left').find(({ line }) => line === 0)?.token;
	const comment = occurrences(lines, 'left').find(({ line }) => line === 1)?.token;
	assert.ok(literal && comment, 'the sample did not tokenize');

	assert.equal(quickSuggestionsCategory(literal), 'string');
	assert.equal(quickSuggestionsCategory(comment), 'comment');
});
