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

test('the author\'s own names are left exactly as written', () => {
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
		'\tScaleBy p',
		'end sub',
	].join('\n');
	const { text } = format(source);
	// keywords and datatypes are fixed ...
	assert.ok(text.includes('End Type'), text);
	assert.ok(text.includes('Function ScaleBy('), text);
	assert.ok(text.includes('\tReturn v.x'), text);
	assert.ok(text.includes('\nSub main()'), text);
	// ... and not one spelling of a declared name is touched, however it is
	// written: the declaration, a lowercase use and a capitalised use all
	// survive side by side
	for (const untouched of ['ScaleBy(', 'vec2', 'VEC2', 'scaleby p', 'ScaleBy p']) {
		assert.ok(text.includes(untouched), `${untouched} was rewritten:\n${text}`);
	}
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

test('a declared symbol is never rewritten, even to a built-in spelling', () => {
	// "Name" is a built-in statement (rename a file), but the author's own
	// procedure is called "name" and must keep that spelling -- in every
	// direction, so a capitalised use is left alone too
	const source = [
		'function name() as double',
		'\treturn 1.0',
		'end function',
		'',
		'sub main()',
		'\tprint name()',
		'\tprint Name()',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('Function name() As Double'), text);
	assert.ok(text.includes('\tPrint name()'), text);
	assert.ok(text.includes('\tPrint Name()'), 'a capitalised use is left alone');
	assert.ok(!text.includes('Function Name('), text);
});

test('built-ins are still capitalised when nothing declares them', () => {
	const { text } = format(['sub main()', '\tdim s as string', '\tname "a" as "b"', 'end sub'].join('\n'));
	assert.ok(text.includes('\tName "a" As "b"'), text);
});

test('a declared name shadowing a built-in keeps its spelling on both sides', () => {
	const source = [
		'function left(byval s as string) as string',
		'\treturn s',
		'end function',
		'sub main()',
		'\tprint left("abc")',
		'\tprint Left("abc")',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('Function left('), text);
	assert.ok(text.includes(') As String'), text);
	assert.ok(text.includes('\tPrint left("abc")'), text);
	assert.ok(text.includes('\tPrint Left("abc")'), text);
});
