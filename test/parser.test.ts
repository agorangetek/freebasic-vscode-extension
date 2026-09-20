import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	callContextAt,
	maskSource,
	parameterNames,
	parseDocument,
	statementContextAt,
	wordAt,
} from '../src/service/parser.ts';

const SAMPLE = [
	"'' doc for mySub",
	'sub mySub(byval a as integer, byref s as string)',
	'  dim tmp as integer',
	'  tmp = 1',
	'end sub',
	'',
	'function add(x as integer, y as integer) as integer',
	'  return x + y',
	'end function',
	'',
	'const MAX = 10',
	'#define SQ(x) ((x)*(x))',
	'',
	'type Point',
	'  px as integer',
	'  py as integer',
	'end type',
	'',
	'enum Color',
	'  Red',
	'  Green',
	'end enum',
	'',
	'dim shared g as integer',
	'top:',
	'#include "other.bi"',
	'print "not a symbol: dim fake as integer"',
	"' dim commented as integer",
	'/' + "' block dim blocked as integer '/",
].join('\n');

test('maskSource blanks comments and strings but keeps offsets', () => {
	const lines = SAMPLE.split('\n');
	const masked = maskSource(SAMPLE);
	assert.equal(masked.length, lines.length);
	for (let i = 0; i < lines.length; i++) {
		assert.equal(masked[i].length, lines[i].length, `line ${i} length changed`);
	}

	assert.ok(!masked.join('\n').includes('fake'), 'string contents should be blanked');
	assert.ok(!masked.join('\n').includes('commented'), 'line comment should be blanked');
	assert.ok(!masked.join('\n').includes('blocked'), 'block comment should be blanked');
	assert.ok(masked[2].includes('dim tmp'), 'real code must survive masking');
});

test('parseDocument finds procedures, locals, types, consts and includes', () => {
	const doc = parseDocument('file:///t.bas', SAMPLE);
	const byName = new Map(doc.symbols.map((s) => [s.name, s]));

	assert.equal(byName.get('mySub')?.kind, 'sub');
	assert.equal(byName.get('mySub')?.params, 'byval a as integer, byref s as string');
	assert.equal(byName.get('mySub')?.doc, 'doc for mySub');
	assert.equal(byName.get('tmp')?.scope, 'mySub', 'locals belong to their procedure');
	assert.equal(byName.get('tmp')?.kind, 'variable');

	assert.equal(byName.get('add')?.kind, 'function');
	assert.equal(byName.get('add')?.returns, 'integer');

	assert.equal(byName.get('MAX')?.kind, 'const');
	assert.equal(byName.get('SQ')?.kind, 'define');
	assert.equal(byName.get('Point')?.kind, 'type');
	assert.equal(byName.get('px')?.kind, 'variable');
	assert.equal(byName.get('Color')?.kind, 'enum');
	assert.equal(byName.get('Red')?.kind, 'const');
	assert.equal(byName.get('g')?.kind, 'variable');
	assert.equal(byName.get('top')?.kind, 'label');

	assert.deepEqual(doc.includes, ['other.bi']);
	assert.ok(!byName.has('fake'), 'string literal must not define a symbol');
	assert.ok(!byName.has('commented'), 'comment must not define a symbol');
	assert.ok(!byName.has('blocked'), 'block comment must not define a symbol');
});

test('one statement may declare several names, with the type first or last', () => {
	const doc = parseDocument(
		'file:///t.bas',
		[
			'dim a, b as integer',
			'const X = 1, Y = 2',
			'dim shared as integer counter',
			'dim as string label',
			'dim as Vec2 origin, other',
			'dim grid(4, 4) as double',
			'dim point as Vec2 = (1.0, 0.0)',
		].join('\n'),
	);
	assert.deepEqual(
		doc.symbols.map((s) => `${s.name}[${s.kind}]`),
		[
			'a[variable]',
			'b[variable]',
			'X[const]',
			'Y[const]',
			'counter[variable]',
			'label[variable]',
			'origin[variable]',
			'other[variable]',
			'grid[variable]',
			'point[variable]',
		],
	);
	// `dim as integer x` used to be recorded as a variable called "as"
	assert.ok(!doc.symbols.some((s) => s.name.toLowerCase() === 'as'));
});

test('a procedure records the line its body ends on', () => {
	const doc = parseDocument('file:///t.bas', SAMPLE);
	assert.equal(doc.symbols.find((s) => s.name === 'mySub')?.endLine, 4);
	assert.equal(doc.symbols.find((s) => s.name === 'add')?.endLine, 8);

	// a prototype has no body, so it has no closing line
	const prototype = parseDocument('file:///t.bas', 'declare function ext() as integer');
	assert.equal(prototype.symbols[0]?.endLine, undefined);
});

test('var declares a name too, inferring its type from the initializer', () => {
	const doc = parseDocument(
		'file:///t.bas',
		[
			'var n = 5',
			'var ratio = 1.5, label = "hi"',
			'var shared global = 0',
			'var total = sum(1, 2)',
		].join('\n'),
	);
	assert.deepEqual(
		doc.symbols.map((s) => `${s.name}[${s.kind}]`),
		['n[variable]', 'ratio[variable]', 'label[variable]', 'global[variable]', 'total[variable]'],
	);
});

test('parameterNames extracts names from a parameter list', () => {
	assert.deepEqual(parameterNames('byval a as integer, byref s as string'), ['a', 's']);
	assert.deepEqual(parameterNames('x as integer'), ['x']);
	assert.deepEqual(parameterNames(''), []);
	assert.deepEqual(parameterNames(undefined), []);
});

test('wordAt returns the identifier under the cursor', () => {
	const text = 'print left(s, 3)';
	const found = wordAt(text, { line: 0, character: 8 });
	assert.equal(found?.word, 'left');
	assert.equal(found?.startChar, 6);
	assert.equal(found?.endChar, 10);
});

test('callContextAt reports the callee and the active parameter', () => {
	const text = 'dim s as string\nprint left(s, ';
	const context = callContextAt(text, { line: 1, character: 14 });
	assert.equal(context?.callee, 'left');
	assert.equal(context?.activeParameter, 1);

	const nested = 'foo(bar(1, 2), ';
	const outer = callContextAt(nested, { line: 0, character: 15 });
	assert.equal(outer?.callee, 'foo');
	assert.equal(outer?.activeParameter, 1);
});

test('statementContextAt classifies the cursor position', () => {
	const text = [
		'  pri',
		'  dim x as ',
		'  end ',
		'  total = 1 + ',
		'  print "a" : ',
		'  ns::mem',
	].join('\n');

	assert.equal(statementContextAt(text, { line: 0, character: 5 }, 'pri').kind, 'start');
	assert.equal(statementContextAt(text, { line: 1, character: 11 }, '').kind, 'as');
	assert.equal(statementContextAt(text, { line: 2, character: 6 }, '').kind, 'end');
	assert.equal(statementContextAt(text, { line: 3, character: 14 }, '').kind, 'expression');
	assert.equal(statementContextAt('declare function ', { line: 0, character: 17 }, '').kind, 'start');
	// a ':' starts a new statement
	assert.equal(statementContextAt(text, { line: 4, character: 14 }, '').kind, 'start');
	// but '::' is a namespace separator, so the statement is not sliced at it
	assert.equal(statementContextAt(text, { line: 5, character: 9 }, 'mem').before, '  ns::');
	// comments and strings are masked away
	assert.equal(statementContextAt("' dim ", { line: 0, character: 6 }, '').kind, 'start');
});
