/*
 * Tests for the canonical-casing rewrite behind the "Format Text" command.
 *
 * Three sources of spelling, in priority order: the author's procedures and
 * types (first letter capitalised), the manual's built-ins and block keywords,
 * and the author's variables and constants (which are never touched).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalizeFirst, capitalizeIdentifiers } from '../src/service/casing.ts';
import { parseDocument } from '../src/service/parser.ts';

function format(source: string) {
	return capitalizeIdentifiers(source, parseDocument('file:///x.bas', source).symbols);
}

test('keywords, datatypes and built-in functions get their canonical spelling', () => {
	const { text, changes } = format(
		['sub main()', '\tdim x as double', '\tscreenres 640, 480', '\tprint left("abc", 2)', 'end sub'].join('\n'),
	);
	assert.equal(
		text,
		[
			'sub Main()',
			'\tdim x as double',
			'\tScreenRes 640, 480',
			'\tprint Left("abc", 2)',
			'end sub',
		].join('\n'),
	);
	assert.equal(changes, 3);
});

test('procedures and types are capitalised, wherever they are written', () => {
	const source = [
		'type vec2',
		'\tx as double',
		'end type',
		'function scaleby(byref v as vec2) as vec2',
		'\treturn v.x',
		'end function',
		'sub main()',
		'\tdim p as vec2',
		'\tscaleby p',
		'\tSCALEBY p',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('type Vec2'), text);
	assert.ok(text.includes('function Scaleby(byref v as Vec2) as Vec2'), text);
	assert.ok(text.includes('\tdim p as Vec2'), text);
	// every spelling of the call converges on the declaration's capitalised one
	assert.ok(text.includes('\tScaleby p'), text);
	assert.ok(!text.includes('scaleby'), text);
	assert.ok(!text.includes('vec2'), text);
});

test('variables, constants and labels are left exactly as written', () => {
	const source = [
		'const WIDTH = 640',
		'const maxSize = 10',
		'sub main()',
		'\tdim MyLocal as integer',
		'\tdim other as integer',
		'\tfor i as integer = 0 to maxSize',
		'\t\tMyLocal = Other',
		'\tnext i',
		'top:',
		'\tgoto top',
		'end sub',
	].join('\n');
	const { text } = format(source);
	for (const untouched of ['WIDTH', 'maxSize', 'MyLocal', 'other', 'Other', 'i', 'top']) {
		assert.ok(text.includes(untouched), `${untouched} was rewritten:\n${text}`);
	}
	// ... while the language around them is still fixed
	assert.ok(text.includes('const WIDTH = 640'), text);
	assert.ok(text.includes('\tfor i as integer = 0 to maxSize'), text);
});

test('a local shadowing a built-in keeps the built-in out of the file', () => {
	// "left" is declared, so the formatter cannot tell the variable from the
	// function and leaves both alone rather than guessing
	const source = [
		'sub main()',
		'\tdim left as integer',
		'\tleft = 1',
		'\tprint left',
		'end sub',
	].join('\n');
	const { text } = format(source);
	assert.ok(text.includes('\tdim left as integer'), text);
	assert.ok(text.includes('\tprint left'), text);
	// the surrounding keywords are still corrected
	assert.ok(text.includes('sub Main()'), text);
	assert.ok(text.includes('\tprint left'), text);
});

test('intrinsic defines keep their upper case', () => {
	const { text } = format('dim a as integer = __fb_darwin__');
	assert.equal(text, 'dim a as integer = __FB_DARWIN__');
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

test('line endings and untouched text are preserved byte for byte', () => {
	const source = ['dim x as integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n');
	const { text } = format(source);
	assert.equal(text, ['dim x as integer', '', "' \u00e9\u00e0\u00fc comment", 'x = 1'].join('\r\n'));
});

test('formatting is idempotent', () => {
	const source = ['sub a()', '\tdim v as vec2', '\tscreenres 1, 2', 'end sub'].join('\n');
	const once = format(source);
	const twice = capitalizeIdentifiers(
		once.text,
		parseDocument('file:///x.bas', once.text).symbols,
	);
	assert.equal(twice.changes, 0, twice.text);
	assert.equal(twice.text, once.text);
});

test('an empty document and a document with nothing to fix are unchanged', () => {
	assert.deepEqual(capitalizeIdentifiers(''), { text: '', changes: 0 });
	const clean = 'sub Main()\nend sub';
	assert.deepEqual(capitalizeIdentifiers(clean), { text: clean, changes: 0 });
});

test('capitalizeFirst only touches the first letter', () => {
	assert.equal(capitalizeFirst('drawBox'), 'DrawBox');
	assert.equal(capitalizeFirst('main'), 'Main');
	assert.equal(capitalizeFirst('MAXSIZE'), 'MAXSIZE');
	assert.equal(capitalizeFirst('scale_by'), 'Scale_by');
	assert.equal(capitalizeFirst('_private'), '_private');
	assert.equal(capitalizeFirst(''), '');
});
