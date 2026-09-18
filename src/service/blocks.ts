/*
 * Editor-side sugar for compound statement blocks.
 *
 * The language facts -- which word opens a block and which word closes it --
 * come from the manual and are generated into src/data/fb-builtins.ts (see the
 * KeyPgEndblock terminator list, handled by tools/gen-data.mjs).  What lives
 * here is only the part the manual cannot supply: the shape of the snippet a
 * user gets when they accept an opener, and which continuations to offer.
 */
import type { FbBlock } from './types.ts';

/**
 * Snippet bodies keyed by lower-cased opener.  `$1`-style tab stops are filled
 * in order and `$0` is where the cursor ends up.  An opener with no entry here
 * is inserted as plain text -- the closer is still offered separately.
 */
const BLOCK_BODIES = new Map<string, string>([
	['sub', 'sub ${1:name}(${2})\n\t$0\nend sub'],
	['function', 'function ${1:name}(${2}) as ${3:integer}\n\t$0\nend function'],
	['constructor', 'constructor ${1:name}(${2})\n\t$0\nend constructor'],
	['destructor', 'destructor ${1:name}()\n\t$0\nend destructor'],
	['property', 'property ${1:name}(${2}) as ${3:integer}\n\t$0\nend property'],
	['operator', 'operator ${1:symbol}(${2}) as ${3:integer}\n\t$0\nend operator'],
	['type', 'type ${1:name}\n\t$0\nend type'],
	['union', 'union ${1:name}\n\t$0\nend union'],
	['enum', 'enum ${1:name}\n\t$0\nend enum'],
	['class', 'class ${1:name}\n\t$0\nend class'],
	['namespace', 'namespace ${1:name}\n\t$0\nend namespace'],
	['scope', 'scope\n\t$0\nend scope'],
	['with', 'with ${1:expression}\n\t$0\nend with'],
	['if', 'if ${1:condition} then\n\t$0\nend if'],
	['select case', 'select case ${1:expression}\n\tcase ${2:value}\n\t\t$0\nend select'],
	['for', 'for ${1:i} as integer = ${2:0} to ${3:n}\n\t$0\nnext ${1:i}'],
	['do', 'do\n\t$0\nloop'],
	['while', 'while ${1:condition}\n\t$0\nwend'],
]);

/** The snippet that expands `block` into a whole skeleton, if there is one. */
export function blockBody(block: FbBlock): string | undefined {
	return BLOCK_BODIES.get(block.opener.toLowerCase());
}

/**
 * Words that may follow "end": the terminator of every block that closes with
 * one.  Loops close with `next`/`loop`/`wend`, which are not valid after "end".
 */
export function endWords(blocks: readonly FbBlock[]): string[] {
	return blocks
		.filter((b) => /^end\s+/i.test(b.closer))
		.map((b) => b.closer.replace(/^end\s+/i, ''))
		.sort((a, b) => a.localeCompare(b));
}

/** Whether a statement may start with `declare`/`extern`, where the bare
 * keyword is wanted rather than a whole block. */
export function isDeclarationPrefix(before: string): boolean {
	return /^\s*(?:(?:public|private|protected|static|overload|virtual|abstract)\s+)*(?:declare|extern)\b/i.test(
		before,
	);
}

/**
 * Statements that continue or close a block.  Offered at the start of a
 * statement, where they are the usual next line.
 */
export const BLOCK_CONTINUATIONS: readonly { label: string; detail: string }[] = [
	{ label: 'else', detail: 'alternative branch' },
	{ label: 'elseif', detail: 'conditional branch' },
	{ label: 'case', detail: 'select case branch' },
	{ label: 'case else', detail: 'default select case branch' },
	{ label: 'loop', detail: 'end of a do loop' },
	{ label: 'wend', detail: 'end of a while loop' },
	{ label: 'next', detail: 'end of a for loop' },
	{ label: 'end if', detail: 'end of an if block' },
	{ label: 'end select', detail: 'end of a select case block' },
	{ label: 'end sub', detail: 'end of a sub' },
	{ label: 'end function', detail: 'end of a function' },
	{ label: 'end type', detail: 'end of a type' },
	{ label: 'end enum', detail: 'end of an enum' },
	{ label: 'end scope', detail: 'end of a scope block' },
	{ label: 'continue', detail: 'continue a loop' },
	{ label: 'exit', detail: 'exit a loop or procedure' },
];
