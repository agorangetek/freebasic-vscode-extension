/*
 * Signature help for built-in functions and user procedures.
 *
 * The label is always the compact call form ("Left(str, n)") and parameters are
 * reported as offsets into it, so the editor can highlight the active parameter
 * without having to guess which occurrence of a name is the parameter.
 */
import { declarationBlock, lookupBuiltin } from './builtins.ts';
import { callContextAt, parameterNames } from './parser.ts';
import type {
	FbDocument,
	FbParameterLabel,
	FbPosition,
	FbSignatureInfo,
	FbSymbol,
} from './types.ts';

/** Locate each name inside `label` as a whole word, in order. */
function labelOffsets(label: string, names: readonly string[]): FbParameterLabel[] {
	const labels: FbParameterLabel[] = [];
	let from = 0;
	for (const name of names) {
		if (!name) {
			labels.push('');
			continue;
		}
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(label.slice(from));
		if (!match) {
			labels.push(name);
			continue;
		}
		const start = from + match.index;
		const end = start + match[0].length;
		labels.push([start, end]);
		from = end;
	}
	return labels;
}

function userProcSignatures(
	document: FbDocument,
	callee: string,
	customSymbols: readonly FbSymbol[],
): FbSignatureInfo[] {
	const all = [...document.symbols, ...customSymbols].filter(
		(s) => s.name.toLowerCase() === callee.toLowerCase() && s.params !== undefined,
	);

	return all.map((symbol) => {
		const names = parameterNames(symbol.params);
		const label = `${symbol.name}(${symbol.params ?? ''})${symbol.returns ? ` as ${symbol.returns}` : ''}`;
		const offsets = labelOffsets(label, names);
		return {
			label,
			parameters: names.map((name, i) => ({ label: offsets[i] ?? name })),
			activeParameter: 0,
			documentation: symbol.doc,
		} satisfies FbSignatureInfo;
	});
}

export function getSignatureHelp(
	document: FbDocument,
	position: FbPosition,
	customSymbols: readonly FbSymbol[] = [],
): FbSignatureInfo | undefined {
	const context = callContextAt(document.text, position);
	if (!context) return undefined;

	const { callee, activeParameter } = context;

	// user procedures take precedence
	const user = userProcSignatures(document, callee, customSymbols);
	if (user.length > 0) {
		return { ...user[0]!, activeParameter };
	}

	const builtin = lookupBuiltin(callee);
	if (!builtin || builtin.signatures.length === 0) return undefined;

	// Prefer the overload that still has an argument for the active position
	const candidates = builtin.signatures.filter((s) => s.params.length > activeParameter);
	const signature = candidates[0] ?? builtin.signatures[0]!;
	const names = signature.params.map((p) => p.name ?? '');
	const offsets = labelOffsets(signature.label, names);

	const documentation = [declarationBlock(signature.text), builtin.summary]
		.filter(Boolean)
		.join('\n\n');

	return {
		label: signature.label,
		parameters: signature.params.map((p, i) => ({
			label: offsets[i] ?? names[i] ?? '',
			documentation: [p.mode, p.type].filter(Boolean).join(' '),
		})),
		activeParameter: Math.min(activeParameter, Math.max(signature.params.length - 1, 0)),
		documentation,
	};
}
