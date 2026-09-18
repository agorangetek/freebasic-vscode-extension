import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	allBuiltins,
	builtinCount,
	builtinMarkdown,
	builtinSource,
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
	assert.equal(left.name, 'Left');
	assert.equal(left.signatures[0].label, 'Left(str, n)');
	assert.deepEqual(
		left.signatures[0].params.map((p) => p.name),
		['str', 'n'],
	);

	const markdown = builtinMarkdown(left);
	assert.match(markdown, /leftmost substring/);
	assert.match(markdown, /^```freebasic\nfunction Left \(/);
	assert.match(markdown, /freebasic\.net\/wiki/);
});

test('generated data carries the preferred casing from example code', () => {
	// the manual writes "Screenres", "Screenlock" and "Getmouse"; real code does not
	for (const name of ['ScreenRes', 'ScreenLock', 'ScreenUnlock', 'ScreenCopy', 'GetMouse', 'MultiKey']) {
		const item = lookupBuiltin(name);
		assert.ok(item, `${name} not found`);
		assert.equal(item.name, name);
		assert.match(item.signatures[0]?.text ?? '', new RegExp(`function ${name} |sub ${name} `));
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
