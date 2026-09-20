/*
 * Tests for the lower-casing rewrite behind the "Format Text" command.
 *
 * One rule: every name the language provides is lower case, and the user's own
 * identifiers -- procedures, types, variables, constants, labels and parameters
 * -- are left exactly as written.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lowercaseLanguageNames } from '../src/service/casing.ts';
import { parseDocument } from '../src/service/parser.ts';

function format(source: string) {
	return lowercaseLanguageNames(source, parseDocument('file:///x.bas', source).symbols);
}

test('keywords, datatypes and built-in functions are folded to lower case', () => {
	const { text, changes } = format(
		[
			'Sub Main()',
			'\tDim x As Double',
			'\tScreenRes 640, 480',
			'\tPrint Left("abc", 2)',
			'End Sub',
		].join('\n'),
	);
	assert.equal(
		text,
		['sub Main()', '\tdim x as double', '\tscreenres 640, 480', '\tprint left("abc", 2)', 'end sub'].join(
			'\n',
		),
	);
	// Sub, Dim, As, Double, ScreenRes, Print, Left, End, Sub
	assert.equal(changes, 9);
});

test('every name the language provides is lower case, defines and directives too', () => {
	const { text } = format(
		['#Include Once "fbgfx.bi"', 'Print __FB_DARWIN__', 'Dim p As Any Ptr = Cptr(Any Ptr, 0)'].join('\n'),
	);
	assert.equal(
		text,
		['#include once "fbgfx.bi"', 'print __fb_darwin__', 'dim p as any ptr = cptr(any ptr, 0)'].join('\n'),
	);
});

test('user procedures, types, variables, constants and parameters are untouched', () => {
	const source = [
		'Type Vec2',
		'\tx As Double',
		'End Type',
		'Function scaleBy(ByRef Value As Vec2) As Vec2',
		'\tReturn Value.x',
		'End Function',
		'Const maxSize = 10',
		'Sub Main()',
		'\tDim MyLocal As Vec2',
		'\tscaleBy MyLocal',
		'\tSCALEBY MyLocal',
		'top:',
		'\tGoto top',
		'End Sub',
	].join('\n');
	const { text } = format(source);

	// the author's names, exactly as written -- including a parameter
	for (const untouched of ['Vec2', 'scaleBy', 'SCALEBY', 'Value', 'maxSize', 'MyLocal', 'top']) {
		assert.ok(text.includes(untouched), `${untouched} was rewritten:\n${text}`);
	}
	// ... while the language around them is folded down
	assert.ok(text.includes('type Vec2'), text);
	assert.ok(text.includes('function scaleBy(byref Value as Vec2) as Vec2'), text);
	assert.ok(text.includes('\treturn Value.x'), text);
	assert.ok(text.includes('\tdim MyLocal as Vec2'), text);
	assert.ok(text.includes('\tgoto top'), text);
	assert.ok(!text.includes('Double'), text);
});

test('a local shadowing a built-in keeps the built-in out of the file', () => {
	// "left" is declared, so the formatter cannot tell the variable from the
	// function and leaves both alone rather than guessing
	const source = [
		'Sub Main()',
		'\tDim left As Integer',
		'\tleft = 1',
		'\tPrint left',
		'End Sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('\tdim left as integer'), text);
	assert.ok(text.includes('\tprint left'), text);
	assert.ok(text.includes('sub Main()'), text);
});

test('comments and string literals are left exactly as written', () => {
	const source = [
		"'' a note about Dim and ScreenRes",
		'\tPrint "no ScreenRes here"',
		'\tDim s As String = "Left( dim"',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes("'' a note about Dim and ScreenRes"));
	assert.ok(text.includes('"no ScreenRes here"'));
	assert.ok(text.includes('"Left( dim"'));
});

test('line endings and untouched text are preserved byte for byte', () => {
	const source = ['Dim x As Integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n');
	const { text } = format(source);
	assert.equal(
		text,
		['dim x as integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n'),
	);
});

test('formatting is idempotent', () => {
	const source = ['Sub a()', '\tDim v As Vec2', '\tScreenRes 1, 2', 'End Sub'].join('\n');
	const once = format(source);
	const twice = lowercaseLanguageNames(
		once.text,
		parseDocument('file:///x.bas', once.text).symbols,
	);
	assert.equal(twice.changes, 0, twice.text);
	assert.equal(twice.text, once.text);
});

test('an empty document and a document with nothing to fix are unchanged', () => {
	assert.deepEqual(lowercaseLanguageNames(''), { text: '', changes: 0 });
	const clean = 'sub Main()\nend sub';
	assert.deepEqual(lowercaseLanguageNames(clean), { text: clean, changes: 0 });
});
