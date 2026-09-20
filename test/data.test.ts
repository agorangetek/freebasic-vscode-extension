import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FB_BUILTINS } from '../src/data/fb-builtins.ts';
import { blockBody, blockContinuations } from '../src/service/blocks.ts';
import {
	allBlocks,
	allBuiltins,
	builtinCount,
	builtinMarkdown,
	builtinSource,
	isCompletableName,
	lookupBuiltin,
} from '../src/service/builtins.ts';

test('built-in data covers the language', () => {
	assert.ok(builtinCount() > 500, `expected >500 built-ins, got ${builtinCount()}`);
	assert.match(builtinSource(), /FreeBASIC/);

	const names = new Set(allBuiltins().map((i) => i.name.toLowerCase()));
	for (const expected of [
		'left',
		'mid',
		'abs',
		'screenres',
		'dim',
		'if',
		'for',
		'type',
		'open',
		'print',
		'input',
		'declare',
		'sub',
		'function',
		'operator',
	]) {
		assert.ok(names.has(expected), `built-in data is missing "${expected}"`);
	}
});

test('every item has a name, a category and a wiki link', () => {
	for (const item of allBuiltins()) {
		assert.ok(item.name.length > 0, 'item without a name');
		assert.ok(item.url.startsWith('https://www.freebasic.net/wiki/'), `bad url for ${item.name}`);
		assert.ok(item.summary.length > 0, `${item.name} has no summary`);
	}
});

test('lookup is case-insensitive and carries signatures', () => {
	const left = lookupBuiltin('LEFT');
	assert.ok(left, 'LEFT not found');
	assert.equal(left.kind, 'function');
	assert.equal(left.category, 'String Functions');
	assert.equal(left.name, 'left');
	assert.equal(left.signatures[0].label, 'left(str, n)');
	assert.deepEqual(
		left.signatures[0].params.map((p) => p.name),
		['str', 'n'],
	);

	const markdown = builtinMarkdown(left);
	assert.match(markdown, /leftmost substring/);
	assert.match(markdown, /^```freebasic\nfunction left \(/);
	assert.match(markdown, /freebasic\.net\/wiki/);
});

test('every name the language provides is lower case', () => {
	// the manual and its examples spell things inconsistently ("Screenres" vs
	// "ScreenRes", "Left" vs "left"); the data is folded down once, so
	// completion, the block scaffolds and the formatter all agree
	for (const item of allBuiltins()) {
		assert.equal(item.name, item.name.toLowerCase(), `${item.name} is not lower case`);
		for (const signature of item.signatures) {
			assert.equal(signature.text, signature.text.toLowerCase(), signature.text);
			assert.equal(signature.label, signature.label.toLowerCase(), signature.label);
			// signature help documents the active parameter from these fields
			for (const parameter of signature.params) {
				for (const [field, value] of Object.entries(parameter)) {
					if (value) {
						assert.equal(value, value.toLowerCase(), `${item.name}: ${field}=${value}`);
					}
				}
			}
		}
	}
	for (const name of ['screenres', 'screenlock', 'screenunlock', 'screencopy', 'getmouse', 'multikey']) {
		const item = lookupBuiltin(name);
		assert.ok(item, `${name} not found`);
		assert.equal(item.name, name);
		assert.match(item.signatures[0]?.text ?? '', new RegExp(`function ${name} |sub ${name} `));
	}
	// the intrinsic defines are language too, underscores and all
	assert.equal(lookupBuiltin('__FB_DARWIN__')?.name, '__fb_darwin__');
});

test('the compiler keyword table travels with the data', () => {
	// a few words have no manual page of their own, so they would otherwise be
	// missed by the formatter: ptr, then, wend, once, protected, ...
	for (const keyword of ['ptr', 'then', 'wend', 'once', 'protected', 'bydesc', 'select', 'include']) {
		assert.ok(
			FB_BUILTINS.keywords.includes(keyword),
			`${keyword} is missing from the compiler keyword list`,
		);
	}
	for (const keyword of FB_BUILTINS.keywords) {
		assert.equal(keyword, keyword.toLowerCase(), `${keyword} is not lower case`);
	}
});

test('generated data has unique ids and unescaped prose', () => {
	const ids = new Set<string>();
	for (const item of allBuiltins()) {
		assert.ok(item.id.length > 0, `${item.name} has no id`);
		assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
		ids.add(item.id);
		assert.ok(!item.summary.includes('""'), `${item.name} summary keeps wakka quote escapes`);
	}
});

test('functions carry parameter types for signature help', () => {
	const abs = lookupBuiltin('abs');
	assert.ok(abs);
	assert.ok(abs.signatures.length >= 3, 'Abs should have several overloads');
	const types = new Set(abs.signatures.flatMap((s) => s.params.map((p) => p.type)));
	assert.ok(types.has('integer'), `expected an integer overload, got ${[...types]}`);
});

test('blocks come from the manual, opener and closer paired', () => {
	const byOpener = new Map(allBlocks().map((b) => [b.opener, b]));
	assert.deepEqual(
		[...byOpener.keys()].sort(),
		[
			'constructor',
			'destructor',
			'do',
			'enum',
			'extern',
			'for',
			'function',
			'if',
			'namespace',
			'operator',
			'property',
			'scope',
			'select case',
			'sub',
			'type',
			'while',
			'with',
		],
	);
	// the KeyPgEndblock list
	assert.equal(byOpener.get('function')?.closer, 'end function');
	assert.equal(byOpener.get('select case')?.closer, 'end select');
	assert.equal(byOpener.get('if')?.closer, 'end if');
	// loops close with a word of their own
	assert.equal(byOpener.get('for')?.closer, 'next');
	assert.equal(byOpener.get('do')?.closer, 'loop');
	assert.equal(byOpener.get('while')?.closer, 'wend');
	for (const block of allBlocks()) {
		assert.match(block.page, /^KeyPg/, `${block.opener} has no manual page`);
	}
});

test('names are identifiers, not manual page titles', () => {
	for (const item of allBuiltins()) {
		assert.ok(
			!/\([^()]*\)\s*$/.test(item.name),
			`${item.name} still carries a page-title qualifier`,
		);
	}
	// documented for hover, but not something to type
	assert.equal(isCompletableName('Operator +'), false);
	assert.equal(isCompletableName('Operator []'), false);
	assert.equal(isCompletableName('PRIVATE:'), false);
	assert.equal(isCompletableName('...'), false);
	// real tokens, including multi-word and preprocessor names
	assert.equal(isCompletableName('Dim'), true);
	assert.equal(isCompletableName('DRAW STRING'), true);
	assert.equal(isCompletableName('#INCLUDE'), true);
	assert.equal(isCompletableName('__FB_DARWIN__'), true);
});

test('blocks are lower case, and their snippets match', () => {
	for (const block of allBlocks()) {
		assert.match(block.opener, /^[a-z]/, `${block.opener} opens a block`);
		assert.match(block.closer, /^[a-z]/, `${block.closer} closes it`);

		const body = blockBody(block);
		if (!body) continue;
		// what gets inserted must read like the label that was offered
		assert.ok(
			body.startsWith(block.opener),
			`${block.opener} inserts "${body.split('\n')[0]}"`,
		);
		assert.ok(
			body.includes(block.closer),
			`${block.opener} does not insert its closer ${block.closer}`,
		);
	}
});

test('continuations are lower case', () => {
	const seen = blockContinuations(allBlocks());
	assert.ok(seen.length >= allBlocks().length);
	for (const { label, detail } of seen) {
		assert.match(label, /^[a-z]/, `"${label}" must be lower case`);
		assert.ok(detail.length > 0, `${label} has no detail`);
	}
});

test('names come from the page, not from a parameter default', () => {
	// ImageCreate's syntax section writes its name as **""ImageCreate""**, so a
	// naive bolded-identifier scan used to pick up the bolded default value of
	// its colour parameter instead
	const imageCreate = lookupBuiltin('ImageCreate');
	assert.ok(imageCreate, 'ImageCreate is missing');
	assert.equal(imageCreate.kind, 'function');
	assert.ok(imageCreate.summary.length > 0);
	assert.match(imageCreate.signatures[0]?.label ?? '', /^imagecreate\(/);
	assert.ok(
		!allBuiltins().some((i) => i.name === 'transparent_color'),
		'a parameter default must not become an item',
	);
});

test('word operators are offered, punctuation ones are not', () => {
	// the pages are titled "Operator ANDALSO (Short Circuit Conjunction)"
	assert.equal(lookupBuiltin('AndAlso')?.kind, 'keyword');
	assert.equal(lookupBuiltin('OrElse')?.kind, 'keyword');
	assert.equal(isCompletableName('AndAlso'), true);
	// "Operator + (Addition)" documents punctuation: usable as documentation,
	// not as something to type
	assert.equal(isCompletableName('Operator +'), false);
});

test('a page mentioning "declare function" is not always a function', () => {
	// these document a modifier or a statement, so they must not be inserted as
	// a call with a parameter placeholder
	for (const name of ['Type', 'As', 'Any', 'Declare', 'Override', '__Fastcall']) {
		const item = lookupBuiltin(name);
		assert.ok(item, `${name} is missing`);
		assert.equal(item.kind, 'keyword', `${name} must not be a procedure`);
	}
	// ... while the ones that really are procedures stay procedures
	for (const name of ['Left', 'ScreenRes', 'Abs', 'Sleep']) {
		assert.equal(lookupBuiltin(name)?.kind, 'function', `${name} lost its kind`);
	}
});

test('calling conventions keep their underscores, in lower case', () => {
	// the manual writes __Fastcall / __Thiscall; the underscores are part of the
	// name, the case is not
	assert.equal(lookupBuiltin('__Fastcall')?.name, '__fastcall');
	assert.equal(lookupBuiltin('__Thiscall')?.name, '__thiscall');
});
