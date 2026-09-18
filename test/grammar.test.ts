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
		string: 'storage.type.string.freebasic',
		zstring: 'storage.type.string.freebasic',
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
