import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompletions, enclosingProcedure, symbolToCompletionItem } from '../src/service/completion.ts';
import { getHover } from '../src/service/hover.ts';
import { FbIndex } from '../src/service/index.ts';
import { parseDocument } from '../src/service/parser.ts';
import { getSignatureHelp } from '../src/service/signature.ts';

/** Resolve a parameter label (literal text or [start, end] offsets) to text. */
function sliceLabel(label: string, paramLabel: string | [number, number]): string {
	return Array.isArray(paramLabel) ? label.slice(paramLabel[0], paramLabel[1]) : paramLabel;
}

const MODULE = [
	"'' Adds two numbers.",
	'function add(x as integer, y as integer) as integer',
	'  return x + y',
	'end function',
	'',
	'sub greet(byref name as string)',
	'  dim greeting as string',
	'  greeting = "hi"',
	'end sub',
	'',
	'const LIMIT = 32',
	'type Vec2',
	'  vx as double',
	'  vy as double',
	'end type',
].join('\n');

const OPTIONS = { keywords: true, builtins: true, snippets: true };

test('enclosingProcedure finds the procedure containing a line', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	assert.equal(enclosingProcedure(doc, { line: 8, character: 2 })?.name, 'greet');
	assert.equal(enclosingProcedure(doc, { line: 0, character: 0 }), undefined);
});

test('completion offers locals, module symbols, built-ins and keywords', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const items = buildCompletions({
		document: doc,
		position: { line: 7, character: 2 }, // inside greet()
		word: '',
		options: OPTIONS,
	});
	const labels = new Set(items.map((i) => i.label));

	assert.ok(labels.has('greeting'), 'local variable should be completed');
	assert.ok(labels.has('name'), 'procedure parameter should be completed');
	assert.ok(labels.has('add'), 'module-level function should be completed');
	assert.ok(labels.has('LIMIT'), 'constant should be completed');
	assert.ok(labels.has('Vec2'), 'user type should be completed');
	assert.ok(labels.has('Left'), 'built-in function should be completed');
	assert.ok(labels.has('ScreenRes'), 'keyword/statement should be completed');

	// ranking: locals before module symbols before built-ins
	const rank = (label: string) => items.find((i) => i.label === label)!.sortText;
	assert.ok(rank('greeting') < rank('add'), 'locals should sort before module symbols');
	assert.ok(rank('add') < rank('Left'), 'module symbols should sort before built-ins');
	assert.ok(rank('Left') < rank('ScreenRes'), 'built-ins should sort before keywords');
});

test('no duplicates in the completion list', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const items = buildCompletions({
		document: doc,
		position: { line: 7, character: 2 },
		word: '',
		options: OPTIONS,
	});
	const seen = new Set<string>();
	for (const item of items) {
		const key = item.label.toLowerCase();
		assert.ok(!seen.has(key), `duplicate completion for ${item.label}`);
		seen.add(key);
	}
});

test('user symbols shadow built-ins of the same name', () => {
	const source = ['function left(byval n as integer) as integer', '  return n', 'end function'].join('\n');
	const doc = parseDocument('file:///shadow.bas', source);
	const items = buildCompletions({
		document: doc,
		position: { line: 2, character: 0 },
		word: 'le',
		options: OPTIONS,
	});
	const left = items.find((i) => i.label.toLowerCase() === 'left');
	assert.ok(left);
	assert.equal(left.kind, 'function');
	assert.match(left.detail, /^function left\(/, 'the user definition should win over the built-in');
});

test('function completions insert a call snippet with placeholders', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const items = buildCompletions({
		document: doc,
		position: { line: 7, character: 2 },
		word: 'add',
		options: OPTIONS,
	});
	const add = items.find((i) => i.label === 'add');
	assert.ok(add);
	assert.equal(add.isSnippet, true);
	assert.equal(add.insertText, 'add(${1:x}, ${2:y})');
});

test('snippets can be turned off', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const items = buildCompletions({
		document: doc,
		position: { line: 7, character: 2 },
		word: 'add',
		options: { ...OPTIONS, snippets: false },
	});
	const add = items.find((i) => i.label === 'add');
	assert.equal(add?.isSnippet, false);
	assert.equal(add?.insertText, 'add');
});

test('workspace symbols are completed and marked as coming from another file', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const other = parseDocument('file:///other.bi', 'declare sub helper(byval n as integer)');
	const items = buildCompletions({
		document: doc,
		workspaceSymbols: other.symbols,
		position: { line: 7, character: 2 },
		word: 'hel',
		options: OPTIONS,
	});
	const helper = items.find((i) => i.label === 'helper');
	assert.ok(helper, 'workspace symbol should be offered');
	assert.match(helper.detail, /helper/);
});

test('hover documents built-ins and user symbols', () => {
	const doc = parseDocument('file:///m.bas', MODULE);

	const builtin = getHover(doc, { line: 7, character: 3 });
	assert.ok(builtin, 'hover over the built-in inside greet() should return something');

	const source = 'dim s as string\nprint left(s, 3)';
	const d2 = parseDocument('file:///h.bas', source);
	const h = getHover(d2, { line: 1, character: 8 });
	assert.ok(h);
	assert.match(h.contents, /leftmost substring/);
	assert.equal(h.range.startChar, 6);

	const userHover = getHover(doc, { line: 1, character: 10 });
	assert.ok(userHover);
	assert.match(userHover.contents, /Adds two numbers/);
});

test('signature help resolves built-ins and user procedures', () => {
	const source = ['dim s as string', 'print left(s, 2)', 'print add(1, '].join('\n');
	const doc = parseDocument('file:///s.bas', MODULE + '\n' + source);
	const offset = MODULE.split('\n').length;

	const builtin = getSignatureHelp(doc, { line: offset + 1, character: 14 });
	assert.ok(builtin);
	assert.match(builtin.label, /Left/);
	assert.equal(builtin.parameters.length, 2);

	const user = getSignatureHelp(doc, { line: offset + 2, character: 12 });
	assert.ok(user);
	assert.match(user.label, /^add\(/);
	// parameters are reported as offsets into the label so the editor can
	// highlight them even when a name also occurs in the procedure name
	assert.deepEqual(
		user.parameters.map((p) => sliceLabel(user.label, p.label)),
		['x', 'y'],
	);
	assert.equal(user.activeParameter, 1);
});

test('the index tracks documents and can drop them', () => {
	const idx = new FbIndex(2);
	idx.index('file:///a.bas', 'sub a()\nend sub');
	idx.index('file:///b.bas', 'sub b()\nend sub');
	assert.equal(idx.stats().files, 2);
	assert.ok(idx.symbols().some((s) => s.name === 'a'));

	idx.index('file:///c.bas', 'sub c()\nend sub');
	assert.equal(idx.stats().files, 2, 'index should stay within its limit');
	idx.remove('file:///c.bas');
	assert.equal(idx.get('file:///c.bas'), undefined);
});

test('symbolToCompletionItem marks callables as snippets', () => {
	const [symbol] = parseDocument('file:///x.bas', 'declare function f(byval a as integer) as integer').symbols;
	const item = symbolToCompletionItem(symbol, '1');
	assert.equal(item.isSnippet, true);
	assert.equal(item.insertText, 'f(${1:a})');
	assert.equal(item.kind, 'function');
});

const CONTEXT_SOURCE = [
	'sub main()',
	'  ',
	'  dim total as ',
	'  total = 1 + ',
	'  end ',
	'end sub',
].join('\n');
const CONTEXT_DOC = parseDocument('file:///ctx.bas', CONTEXT_SOURCE);
const CONTEXT_OPTIONS = { keywords: true, builtins: true, snippets: true };

function complete(line: number, character: number, word = '') {
	return buildCompletions({
		document: CONTEXT_DOC,
		position: { line, character },
		word,
		options: CONTEXT_OPTIONS,
	});
}

test('a block opener expands into the whole block', () => {
	const items = complete(1, 2);
	const fn = items.find((i) => i.label === 'function');
	assert.ok(fn, 'function is offered at the start of a statement');
	assert.equal(fn.isSnippet, true);
	assert.equal(fn.insertText, 'function ${1:name}(${2}) as ${3:integer}\n\t$0\nend function');
	assert.match(fn.detail, /end function/);

	// every block from the manual is offered, and closed
	for (const [opener, closer] of [
		['sub', 'end sub'],
		['type', 'end type'],
		['for', 'next'],
		['do', 'loop'],
		['while', 'wend'],
		['select case', 'end select'],
	]) {
		const item = items.find((i) => i.label === opener);
		assert.ok(item, `${opener} is offered`);
		assert.equal(item.isSnippet, true, `${opener} expands into a block`);
		assert.match(item.insertText, new RegExp(closer.replace(' ', '\\s+'), 'i'));
	}
});

test('plain keywords are still inserted as plain text when snippets are off', () => {
	const items = buildCompletions({
		document: CONTEXT_DOC,
		position: { line: 1, character: 2 },
		word: '',
		options: { ...CONTEXT_OPTIONS, snippets: false },
	});
	const sub = items.find((i) => i.label === 'sub');
	assert.equal(sub?.isSnippet, false);
	assert.equal(sub?.insertText, 'sub');
});

test('after "end" only block terminators are offered', () => {
	const items = complete(4, 6);
	const labels = items.map((i) => i.label);
	// every offered built-in is a block terminator, described as such
	const terminators = items.filter((i) => /^end /i.test(i.detail)).map((i) => i.label);
	assert.deepEqual(terminators, [
		'constructor',
		'destructor',
		'enum',
		'extern',
		'function',
		'if',
		'namespace',
		'operator',
		'property',
		'scope',
		'select',
		'sub',
		'type',
		'with',
	]);
	assert.ok(!labels.includes('dim'), 'no ordinary keywords after "end"');
	// loops end with their own word, never with "end next"
	assert.ok(!labels.includes('next'));
	assert.ok(!labels.includes('loop'));
	assert.ok(!labels.includes('wend'));
});

test('after "as" only types are offered', () => {
	const items = complete(2, 14);
	const labels = items.map((i) => i.label);
	assert.ok(labels.includes('integer'), labels.join(', '));
	assert.ok(labels.includes('string'));
	assert.ok(!labels.includes('dim'));
	assert.ok(!labels.includes('print'));
	assert.ok(!labels.includes('function'));
});

test('mid-expression drops statement keywords but keeps operators', () => {
	const items = complete(3, 14);
	const labels = items.map((i) => i.label);
	assert.ok(labels.includes('Abs'), 'functions are always available');
	assert.ok(labels.includes('mod'), 'operators are valid in an expression');
	assert.ok(labels.includes('cast'));
	assert.ok(!labels.includes('dim'), 'dim cannot appear mid-expression');
	assert.ok(!labels.includes('print'));
	assert.ok(!labels.includes('sub'));
});

test('declaration prefixes get the bare keyword, not a block', () => {
	const doc = parseDocument('file:///d.bas', 'declare function ');
	const items = buildCompletions({
		document: doc,
		position: { line: 0, character: 17 },
		word: '',
		options: CONTEXT_OPTIONS,
	});
	const fn = items.find((i) => i.label === 'function');
	assert.equal(fn?.isSnippet, false);
	assert.equal(fn?.insertText, 'function');
});

test('what gets inserted is spelled like the label that was offered', () => {
	// the popup shows "Function" or "End If"; inserting "function" would be a
	// different token as far as the reader is concerned
	const items = [...complete(1, 2), ...complete(4, 6)];
	assert.ok(items.length > 100, 'expected a large list to check');
	for (const item of items) {
		assert.ok(
			item.insertText.startsWith(item.label),
			`"${item.label}" inserts "${item.insertText.split('\n')[0]}"`,
		);
	}
});

test('block continuations are spelled like the block they close', () => {
	const labels = complete(1, 2).map((i) => i.label);
	for (const closer of ['end sub', 'end function', 'end if', 'end select', 'end type', 'next', 'loop', 'wend']) {
		assert.ok(labels.includes(closer), `${closer} is offered, got ${labels.filter((l) => /end|next|loop|wend/i.test(l)).join(', ')}`);
	}
	for (const extra of ['else', 'elseif', 'case', 'case else', 'continue', 'exit']) {
		assert.ok(labels.includes(extra), `${extra} is offered`);
	}
});

test('only items that start with the typed text are offered', () => {
	const doc = parseDocument('file:///m.bas', MODULE);
	const labelsFor = (word: string) =>
		new Map(
			buildCompletions({
				document: doc,
				position: { line: 7, character: 2 },
				word,
				options: OPTIONS,
			}).map((i) => [i.label, i]),
		);

	const s = labelsFor('s');
	assert.ok(s.has('ScreenRes'), 'a name starting with s is offered');
	assert.ok(!s.has('Abs'), 'a name that merely contains s is not');
	assert.ok(!s.has('greeting'), 'nor one that merely contains s later');

	const le = labelsFor('le');
	assert.ok(le.has('Left'));
	assert.ok(!le.has('ScreenRes'), 'typing more narrows the list');

	// the editor matches case-insensitively, and so does this
	assert.ok(labelsFor('SC').has('ScreenRes'));

	// with nothing typed, nothing is filtered
	assert.ok(labelsFor('').has('Abs'));
});
