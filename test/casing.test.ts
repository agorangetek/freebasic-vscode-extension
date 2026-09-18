/*
 * Tests for the canonical-casing rewrite behind the "Format Text" command.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalizeIdentifiers } from '../src/service/casing.ts';
import { parseDocument } from '../src/service/parser.ts';

function format(source: string) {
	const declared = parseDocument('file:///x.bas', source).symbols.map((s) => s.name);
	return capitalizeIdentifiers(source, declared);
}

test('keywords, datatypes and built-in functions get their canonical spelling', () => {
	const { text, changes } = format(
		['sub main()', '\tdim x as double', '\tscreenres 640, 480', '\tprint left("abc", 2)', 'end sub'].join('\n'),
	);
	assert.equal(
		text,
		['Sub main()', '\tDim x As Double', '\tScreenRes 640, 480', '\tPrint Left("abc", 2)', 'End Sub'].join('\n'),
	);
	assert.equal(changes, 9);
});

test('intrinsic defines keep their upper case', () => {
	const { text } = format('dim a as integer = __fb_darwin__');
	assert.equal(text, 'Dim a As Integer = __FB_DARWIN__');
});

test('comments and string literals are left exactly as written', () => {
	const source = [
		"'' a note about dim and screenres",
		'\tprint "no screenres here"',
		'\tdim s as string = "left( dim"',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes("'' a note about dim and screenres"));
	assert.ok(text.includes('"no screenres here"'));
	assert.ok(text.includes('"left( dim"'));
});

test('uses of a symbol follow its declaration', () => {
	const source = [
		'type Vec2',
		'\tx as double',
		'end type',
		'function ScaleBy(byref v as vec2) as VEC2',
		'\treturn v.x',
		'end function',
		'sub main()',
		'\tdim p as vec2',
		'\tscaleby p',
		'end sub',
	].join('\n');
	const { text } = format(source);
	// the call and the uses are normalised to the declaration
	assert.ok(text.includes('Function ScaleBy(ByRef v As Vec2) As Vec2'), text);
	assert.ok(text.includes('\tScaleBy p'), text);
	assert.ok(text.includes('\tDim p As Vec2'), text);
	assert.ok(!text.includes('scaleby'), text);
	assert.ok(!text.includes('vec2'), text);
});

test('line endings and untouched text are preserved byte for byte', () => {
	const source = ['dim x as integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n');
	const { text } = format(source);
	assert.equal(text, ['Dim x As Integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n'));
});

test('formatting is idempotent', () => {
	const source = ['sub a()', '\tdim v as vec2', '\tscreenres 1, 2', 'end sub'].join('\n');
	const once = format(source);
	const twice = capitalizeIdentifiers(once.text, ['a', 'v']);
	assert.equal(twice.changes, 0, twice.text);
	assert.equal(twice.text, once.text);
});

test('an empty document and a document with nothing to fix are unchanged', () => {
	assert.deepEqual(capitalizeIdentifiers(''), { text: '', changes: 0 });
	const clean = 'Sub main()\nEnd Sub';
	assert.deepEqual(capitalizeIdentifiers(clean), { text: clean, changes: 0 });
});

test('a declared symbol outranks a built-in spelled the same way', () => {
	// "Name" is a built-in statement (rename a file), but the author's own
	// procedure is called "name" and must keep that spelling
	const source = [
		'function name() as double',
		'\treturn 1.0',
		'end function',
		'',
		'sub main()',
		'\tprint name()',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('Function name() As Double'), text);
	assert.ok(text.includes('Print name()'), 'the call follows the declaration');
	assert.ok(!text.includes('Name()'), text);
});

test('built-ins are still capitalised when nothing declares them', () => {
	const { text } = format(['sub main()', '\tdim s as string', '\tname "a" as "b"', 'end sub'].join('\n'));
	assert.ok(text.includes('\tName "a" As "b"'), text);
});

test('a declared name shadowing a built-in function keeps its spelling', () => {
	const source = [
		'function left(byval s as string) as string',
		'\treturn s',
		'end function',
		'sub main()',
		'\tprint left("abc")',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('Function left('), text);
	assert.ok(text.includes(') As String'), text);
	assert.ok(text.includes('Print left("abc")'), 'the built-in call follows the declaration');
	assert.ok(!text.includes('Left('), text);
});
