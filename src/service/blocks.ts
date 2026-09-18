/*
 * Editor-side sugar for compound statement blocks.
 *
 * The language facts -- which word opens a block, which word closes it, and how
 * both are spelled -- come from the manual and are generated into
 * src/data/fb-builtins.ts (the KeyPgEndblock terminator list, handled by
 * tools/gen-data.mjs).  What lives here is only the part the manual cannot
 * supply: the shape of the snippet a user gets when they accept an opener, and
 * which statement heads to offer inside a block.
 *
 * Snippet bodies are composed from the generated opener and closer instead of
 * being spelled out, so the inserted text is always capitalised the same way as
 * the label the completion list showed.
 */
import type { FbBlock } from './types.ts';

/**
 * Statement heads that continue a block without opening one.  Spelled out
 * because the manual has no page of its own for most of them; `Case`,
 * `Continue` and `Exit` do have one and are spelled the same way.
 */
const EXTRA_CONTINUATIONS: readonly { label: string; detail: string }[] = [
	{ label: 'Else', detail: 'alternative branch' },
	{ label: 'ElseIf', detail: 'conditional branch' },
	{ label: 'Case', detail: 'select case branch' },
	{ label: 'Case Else', detail: 'default select case branch' },
	{ label: 'Continue', detail: 'continue a loop' },
	{ label: 'Exit', detail: 'exit a loop or procedure' },
];

/**
 * Snippet bodies keyed by lower-cased opener.  `$1`-style tab stops are filled
 * in order and `$0` is where the cursor ends up.  An opener with no entry here
 * is inserted as plain text.
 */
const BLOCK_BODIES = new Map<string, (b: FbBlock) => string>([
	['sub', (b) => `${b.opener} \${1:name}(\${2})\n\t$0\n${b.closer}`],
	['function', (b) => `${b.opener} \${1:name}(\${2}) As \${3:Integer}\n\t$0\n${b.closer}`],
	['constructor', (b) => `${b.opener} \${1:name}(\${2})\n\t$0\n${b.closer}`],
	['destructor', (b) => `${b.opener} \${1:name}()\n\t$0\n${b.closer}`],
	['property', (b) => `${b.opener} \${1:name}(\${2}) As \${3:Integer}\n\t$0\n${b.closer}`],
	[
		'operator',
		(b) => `${b.opener} \${1:symbol}(\${2}) As \${3:Integer}\n\t$0\n${b.closer}`,
	],
	['type', (b) => `${b.opener} \${1:name}\n\t$0\n${b.closer}`],
	['union', (b) => `${b.opener} \${1:name}\n\t$0\n${b.closer}`],
	['enum', (b) => `${b.opener} \${1:name}\n\t$0\n${b.closer}`],
	['class', (b) => `${b.opener} \${1:name}\n\t$0\n${b.closer}`],
	['namespace', (b) => `${b.opener} \${1:name}\n\t$0\n${b.closer}`],
	['scope', (b) => `${b.opener}\n\t$0\n${b.closer}`],
	['with', (b) => `${b.opener} \${1:expression}\n\t$0\n${b.closer}`],
	['if', (b) => `${b.opener} \${1:condition} Then\n\t$0\n${b.closer}`],
	[
		'select case',
		(b) => `${b.opener} \${1:expression}\n\tCase \${2:value}\n\t\t$0\n${b.closer}`,
	],
	[
		'for',
		(b) => `${b.opener} \${1:i} As Integer = \${2:0} To \${3:n}\n\t$0\n${b.closer} \${1:i}`,
	],
	['do', (b) => `${b.opener}\n\t$0\n${b.closer}`],
	['while', (b) => `${b.opener} \${1:condition}\n\t$0\n${b.closer}`],
]);

/** The snippet that expands `block` into a whole skeleton, if there is one. */
export function blockBody(block: FbBlock): string | undefined {
	return BLOCK_BODIES.get(block.opener.toLowerCase())?.(block);
}

/**
 * Words that may follow "end": the terminator of every block that closes with
 * one.  Loops close with `Next`/`Loop`/`Wend`, which are not valid after "end".
 */
export function endWords(blocks: readonly FbBlock[]): string[] {
	return blocks
		.filter((b) => /^end\s+/i.test(b.closer))
		.map((b) => b.closer.replace(/^end\s+/i, ''))
		.sort((a, b) => a.localeCompare(b));
}

/**
 * Statement heads to offer at the start of a statement: the closer of every
 * block, plus the branch and loop-control statements used inside one.  Spelling
 * follows the generated data, so it matches the block the closer belongs to.
 */
export function blockContinuations(
	blocks: readonly FbBlock[],
): { label: string; detail: string }[] {
	const out = blocks.map((b) => ({
		label: b.closer,
		detail: /^end\s/i.test(b.closer)
			? `end of the ${b.opener.toLowerCase()} block`
			: `end of the ${b.opener.toLowerCase()} loop`,
	}));
	for (const { label, detail } of EXTRA_CONTINUATIONS) {
		out.push({ label, detail });
	}
	return out;
}

/** Whether a statement may start with `declare`/`extern`, where the bare
 * keyword is wanted rather than a whole block. */
export function isDeclarationPrefix(before: string): boolean {
	return /^\s*(?:(?:public|private|protected|static|overload|virtual|abstract)\s+)*(?:declare|extern)\b/i.test(
		before,
	);
}
