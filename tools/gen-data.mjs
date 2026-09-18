#!/usr/bin/env node
/*
 * Generates src/data/fb-builtins.json for the FreeBASIC extension.
 *
 * The FreeBASIC manual ships as wiki text in the compiler source tree
 * (doc/manual/cache/KeyPg*.wakka), one page per keyword / built-in function /
 * operator, each with a summary, syntax, parameters, dialect notes and a
 * category link.  Parsing those gives the extension an authoritative list of
 * the language's keywords and built-ins, with signatures for completion and
 * signature help and text for hover.
 *
 * Usage:
 *   node tools/gen-data.mjs [path-to-fbc-source]
 *   FB_SRC=/path/to/fbc node tools/gen-data.mjs
 *
 * The generated JSON is committed, so building the extension does not require
 * a compiler checkout; re-run this only to refresh the data.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const fbcRoot =
	process.argv[2] ||
	process.env.FB_SRC ||
	join(root, '..', '..', 'freebasic-macos', 'fbc');

const cacheDir = join(fbcRoot, 'doc', 'manual', 'cache');

/* ------------------------------------------------------------------ helpers */

/** Strip the manual's inline wiki markup. */
function cleanWiki(s) {
	return s
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[Target|Text]] -> Text
		.replace(/\[\[([^\]]+)\]\]/g, '$1') // [[Target]] -> Target
		.replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
		.replace(/\/\/(.+?)\/\//g, '$1') // //italic//
		.replace(/##(.+?)##/g, '$1') // ##code##
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The bolded identifier in a syntax section: `**Left**`, `**""ImageCreate""**`.
 * Skips bolded text that is not a name (parameter defaults, keywords quoted in
 * prose) and returns undefined when there is none, so the caller can fall back
 * to the page title.
 */
function boldName(rawSyntax) {
	for (const m of rawSyntax.matchAll(/\*\*(.+?)\*\*/g)) {
		const text = unescapeWakka(m[1]).replace(/"/g, '').trim();
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text;
	}
	return undefined;
}

/** Content of a {{fbdoc item="..."}} block, up to the next item or EOF. */
function section(text, name) {
	const re = new RegExp(
		`\\{\\{fbdoc item="${name}"(?:\\s+value="([^"]*)")?\\}\\}([\\s\\S]*?)(?=\\{\\{fbdoc item=|$)`,
		'i',
	);
	const m = text.match(re);
	return m ? m[2] : '';
}

/** Value of a {{fbdoc item="..." value="..."}} marker. */
function markerValue(text, name) {
	const re = new RegExp(`\\{\\{fbdoc item="${name}"\\s+value="([^"]*)"\\}\\}`, 'i');
	const m = text.match(re);
	return m ? m[1] : '';
}

/** Lines of a fenced section, with the ## fences and wiki markup removed. */
function sectionLines(text, name) {
	return section(text, name)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && l !== '##' && l !== '#')
		.map((l) => cleanWiki(l.replace(/^##\s*/, '').replace(/##$/, '')))
		.filter((l) => l.length > 0);
}

/** Split "a, b, c" on top-level commas only (parens/brackets nest). */
function splitParams(s) {
	const out = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	if (cur.trim()) out.push(cur);
	return out.map((p) => p.trim()).filter(Boolean);
}

/** "byref str as const string" -> { mode, name, type } */
function parseParam(p) {
	let mode = '';
	const mMatch = p.match(/^(byval|byref|bydesc)\s+/i);
	if (mMatch) {
		mode = mMatch[1].toLowerCase();
		p = p.slice(mMatch[0].length);
	}
	const asMatch = p.match(/^(.+?)\s+as\s+(.+)$/i);
	if (asMatch) {
		return { mode, name: asMatch[1].trim(), type: asMatch[2].trim() };
	}
	return { mode, name: p.trim(), type: '' };
}

/** Build a compact call label: Left(str, n) */
function callLabel(name, params) {
	const args = params.map((p) => (p.name ? p.name.replace(/[^A-Za-z0-9_]/g, '') : '')).filter(Boolean);
	return `${name}(${args.join(', ')})`;
}

/* -------------------------------------------------------------------- parse */

function parsePage(file, text) {
	const title = markerValue(text, 'title').trim();
	if (!title) return null;

	// The summary is the line right after the title marker (which ends in ----)
	const afterTitle = text.slice(text.search(/\{\{fbdoc item="title"/i));
	const summaryMatch = afterTitle.match(/----\s*\n+(.+)/);
	const summary = summaryMatch ? cleanWiki(summaryMatch[1]) : '';

	const syntaxLines = sectionLines(text, 'syntax');
	const usageLines = sectionLines(text, 'usage');

	// Canonical spelling from the bolded name in the syntax, else the title.
	// The manual bolds quoted names too -- ImageCreate's syntax section says
	// **""ImageCreate""** -- so the escapes and the quotes have to come off
	// before the name can be recognised. Taking the first bolded identifier
	// without doing that used to yield the default value of a parameter
	// instead: "transparent_color".
	const rawSyntax = section(text, 'syntax');
	let name = boldName(rawSyntax) ?? title;

	// Operator pages are titled "Operator ANDALSO (Short Circuit Conjunction)".
	// The word operators are usable in an expression, so they are worth
	// offering; the punctuation ones ("Operator + (Addition)") are not, and
	// keep their unwieldy name, which isCompletableName() then filters out.
	const operatorWord = name
		.replace(/\s*\([^()]*\)\s*$/, '')
		.trim()
		.match(/^operator[ \t]+([A-Za-z_][A-Za-z0-9_]*)$/i);
	if (operatorWord) name = operatorWord[1];

	// kind: declared function/sub, or a statement/operator keyword
	let kind = 'keyword';
	const joined = syntaxLines.join(' ');
	if (/^declare\s+function\b/i.test(joined) || /\bdeclare\s+function\b/i.test(joined)) kind = 'function';
	else if (/\bdeclare\s+sub\b/i.test(joined)) kind = 'sub';
	else if (usageLines.some((l) => /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(l) && l.includes('='))) {
		// "result = Abs( number )" style usage without a declare line
		kind = 'function';
	}

	// A page can mention "declare function" while documenting something that is
	// not a procedure at all: the calling-convention pages are written
	// "declare Sub name __Fastcall", so the bolded name is a modifier, not the
	// procedure. Only a name sitting right after the function/sub keyword is a
	// declaration -- anything else is a keyword, which also keeps it from being
	// inserted as a call.
	if (kind !== 'keyword' && /declare\s+(?:function|sub)\b/i.test(joined)) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const declaration = new RegExp(
			`\\b(?:declare\\s+)?(?:function|sub)\\s+\\*{0,2}"*${escaped}\\b`,
			'i',
		);
		if (!declaration.test(joined)) kind = 'keyword';
	}

	// signatures from the syntax section
	const signatures = [];
	for (const line of syntaxLines) {
		const decl = line.replace(/^declare\s+/i, '');
		const pm = decl.match(/\((.*)\)/);
		const params = pm ? splitParams(pm[1]).map(parseParam) : [];
		signatures.push({
			text: line,
			label: pm ? callLabel(name, params) : name,
			params,
		});
	}

	// category from the "back" link, e.g. CatPgString|String Functions
	const back = markerValue(text, 'back');
	const category = back.includes('|') ? back.split('|').pop().trim() : back.trim();

	const dialect = sectionLines(text, 'lang').map((l) => l.replace(/^-\s*/, ''));

	return {
		name,
		title,
		kind,
		category,
		summary,
		usage: usageLines,
		signatures,
		dialect,
		url: `https://www.freebasic.net/wiki/${basename(file, '.wakka')}`,
		page: basename(file, '.wakka'),
	};
}

/* --------------------------------------------------------------------- main */

const files = readdirSync(cacheDir).filter((f) => /^KeyPg.*\.wakka$/.test(f));
if (files.length === 0) {
	console.error(`no KeyPg*.wakka pages found in ${cacheDir}`);
	console.error('pass the path to an fbc source checkout, or set FB_SRC');
	process.exit(1);
}

const items = [];
for (const f of files.sort()) {
	const parsed = parsePage(f, readFileSync(join(cacheDir, f), 'utf8'));
	if (parsed) items.push(parsed);
}

/*
 * The manual spells some keywords in a way nobody writes in real code
 * ("Screenres", "Screenlock").  The compiler's own 1500+ example programs are
 * real, conventionally-cased FreeBASIC, so learn the preferred spelling of
 * each name from them: prefer a mixed-case variant (ScreenRes, MultiKey) over
 * an all-caps or all-lower one, then the most frequent.
 */
function preferredCasing(names, examplesDir) {
	const wanted = new Set(names.map((n) => n.toLowerCase()));
	const counts = new Map();

	let files;
	try {
		files = readdirSync(examplesDir, { recursive: true }).filter((f) =>
			typeof f === 'string' && /\.(bas|bi)$/i.test(f),
		);
	} catch {
		return new Map();
	}

	for (const rel of files) {
		let text;
		try {
			text = readFileSync(join(examplesDir, rel), 'utf8');
		} catch {
			continue;
		}
		for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
			const word = m[0];
			const lower = word.toLowerCase();
			if (!wanted.has(lower)) continue;
			let variants = counts.get(lower);
			if (!variants) {
				variants = new Map();
				counts.set(lower, variants);
			}
			variants.set(word, (variants.get(word) ?? 0) + 1);
		}
	}

	const best = new Map();
	for (const [lower, variants] of counts) {
		const entries = [...variants.entries()];
		const mixed = entries.filter(([w]) => /[A-Z]/.test(w) && /[a-z]/.test(w));
		const pool = mixed.length > 0 ? mixed : entries.filter(([w]) => /[a-z]/.test(w));
		if (pool.length === 0) continue;
		pool.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
		best.set(lower, pool[0][0]);
	}
	return best;
}

/** The name right after the procedure keyword in a declaration line. */
const DECL_NAME_RE =
	/^(\s*(?:declare\s+)?(?:function|sub|constructor|destructor|property|operator|static)\s+)([A-Za-z_]\w*)/i;

/** Rewrite the declared procedure name, keeping the rest of the line intact. */
function renameInDeclaration(text, name) {
	const m = text.match(DECL_NAME_RE);
	if (!m) return text;
	return m[1] + name + text.slice(m[1].length + m[2].length);
}

/** Wakka escapes a quote by doubling it; the manual relies on this heavily. */
function unescapeWakka(text) {
	return text.replace(/""/g, '"');
}

const preferred = preferredCasing(
	items.map((i) => i.name),
	join(fbcRoot, 'examples'),
);
let renamed = 0;
for (const item of items) {
	const better = preferred.get(item.name.toLowerCase());
	if (better && better !== item.name) {
		item.name = better;
		renamed++;
	}
	// Where a page has no identifier in its syntax, its title is used as the
	// name -- and titles disambiguate themselves, as in "ALIAS (Name)" or
	// "Operator + (Addition)".  The qualifier belongs to the title, not the
	// name; the title is kept as-is for the manual link.
	let bare = item.name;
	for (let previous = ''; bare !== previous; ) {
		previous = bare;
		bare = bare.replace(/\s*\([^()]*\)\s*$/, '').trim();
	}
	if (bare.length > 0) item.name = bare;

	// declarations, call labels and prose all carried the manual's spelling
	for (const sig of item.signatures) {
		sig.text = renameInDeclaration(sig.text, item.name);
		sig.label = callLabel(item.name, sig.params);
	}
	item.summary = unescapeWakka(item.summary);
	item.usage = item.usage.map(unescapeWakka);
	item.dialect = item.dialect.map(unescapeWakka);
}

/* ------------------------------------------------------------------ blocks */

/*
 * There is no page for "End Function": "End" is documented once, on
 * KeyPgEndblock, whose syntax line lists every block terminator and links to
 * the page that opens the block.  That list is the authority for these; the
 * loops close with a word of their own (Next / Loop / Wend), which their own
 * page's syntax section ends with.
 */
const TERMINATOR_RE =
	/^(Next|Loop|Wend|End\s+(?:Sub|Function|If|Select|Type|Enum|Scope|With|Namespace|Extern|Constructor|Destructor|Operator|Property))\b/i;

/** These open with more than one word. */
const OPENING_WORDS = new Map([['select', 'Select Case']]);
/** The endblock page links to KeyPgExtern; the content is on KeyPgExternBlock. */
const PAGE_ALIASES = new Map([['KeyPgExtern', 'KeyPgExternBlock']]);

/** The terminator a page's own syntax section ends with. */
function terminatorOf(item) {
	const hits = (item?.signatures ?? [])
		.map((s) => TERMINATOR_RE.exec(s.text.trim())?.[1])
		.filter(Boolean);
	return hits.length > 0 ? hits[hits.length - 1] : undefined;
}

const byPage = new Map(items.map((i) => [i.page, i]));
const blocks = [];
const addBlock = (opener, closer, page) => {
	if (blocks.some((b) => b.opener.toLowerCase() === opener.toLowerCase())) return;
	blocks.push({ opener, closer, page });
};

const endblockPage = readFileSync(join(cacheDir, 'KeyPgEndblock.wakka'), 'utf8');
for (const m of section(endblockPage, 'syntax').matchAll(/\[\[(KeyPg\w+)\|([^\]|]+)\]\]/g)) {
	const word = OPENING_WORDS.get(m[2].toLowerCase()) ?? m[2];
	addBlock(word, `End ${m[2]}`, PAGE_ALIASES.get(m[1]) ?? m[1]);
}
for (const [page, fallback] of [
	['KeyPgFornext', 'Next'],
	['KeyPgDo', 'Loop'],
	['KeyPgWhile', 'Wend'],
]) {
	const item = byPage.get(page);
	addBlock(item?.name ?? fallback, terminatorOf(item) ?? fallback, page);
}
for (const block of blocks) {
	const better = preferred.get(block.opener.toLowerCase());
	if (better) block.opener = better;
}

// The manual has separate pages for the same name in different roles (Mid
// function vs statement); keep both but give them stable unique keys.
const seen = new Map();
for (const it of items) {
	const key = `${it.name.toLowerCase()}|${it.kind}`;
	it.id = seen.has(key) ? `${key}#${it.page}` : key;
	seen.set(key, true);
}

const version = (() => {
	try {
		return readFileSync(join(fbcRoot, 'version.mk'), 'utf8').match(/FBVERSION\s*:=\s*(\S+)/)?.[1] ?? 'unknown';
	} catch {
		return 'unknown';
	}
})();

const out = {
	source: `FreeBASIC ${version} manual`,
	generatedFrom: cacheDir,
	count: items.length,
	blocks,
	items,
};

mkdirSync(join(root, 'src', 'data'), { recursive: true });
const outFile = join(root, 'src', 'data', 'fb-builtins.json');
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');

// Also emit a TS module: the extension imports it directly (so esbuild inlines
// it into the bundle) and node's type stripping can import it from tests.
const tsFile = join(root, 'src', 'data', 'fb-builtins.ts');
writeFileSync(
	tsFile,
	[
		'/* Generated by tools/gen-data.mjs -- do not edit by hand.',
		` * Source: ${out.source}`,
		' * Regenerate with: npm run gen-data',
		' */',
		"import type { FbBuiltinData } from '../service/types.ts';",
		'',
		`export const FB_BUILTINS: FbBuiltinData = ${JSON.stringify(out)};`,
		'',
	].join('\n'),
);

const byKind = {};
const byCategory = {};
for (const it of items) {
	byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
	byCategory[it.category] = (byCategory[it.category] ?? 0) + 1;
}
console.log(`wrote ${outFile}`);
console.log(`wrote ${tsFile}`);
console.log(`  ${items.length} items from ${files.length} pages`);
console.log(`  ${blocks.length} blocks:`, blocks.map((b) => `${b.opener}..${b.closer}`).join(', '));
console.log('  kinds:', byKind);
console.log(
	'  top categories:',
	Object.entries(byCategory)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6),
);
// The compiler's lexer is the authority on what the language accepts, the
// manual on what it means. Comparing the two is how "ImageCreate" and the
// "AndAlso"/"OrElse" operators were found missing from this data.
try {
	const table = readFileSync(join(fbcRoot, 'src', 'compiler', 'symb-keyword.bas'), 'utf8');
	const rows = [...table.matchAll(/\(\s*@"([^"]+)"\s*,\s*(FB_TK_\w+)\s*,\s*(FB_TKCLASS_\w+)/g)];
	const covered = new Set(items.map((i) => i.name.toLowerCase()));
	const absent = rows.map((m) => m[1]).filter((n) => !covered.has(n.toLowerCase()));
	console.log(`  compiler: ${rows.length} keywords, ${absent.length} with no page in this data`);
	if (absent.length > 0) console.log('    no manual page:', absent.join(', '));
} catch {
	// no compiler checkout alongside: nothing to compare against
}

for (const want of ['left', 'abs', 'screenres', 'dim', 'open', 'operator']) {
	const found = items.filter((i) => i.name.toLowerCase() === want);
	console.log(
		`  check ${want.padEnd(10)} ->`,
		found.map((f) => `${f.name}[${f.kind}] ${f.signatures[0]?.label ?? ''}`).join(' | ') || 'MISSING',
	);
}
