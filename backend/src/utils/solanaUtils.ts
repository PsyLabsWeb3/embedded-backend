import {
  ParsedInstruction,
  PartiallyDecodedInstruction,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";

export type ParsedSysTransfer = {
  from: string;
  to: string;
  lamports: number;
};

export function* allParsedInstructions(
  tx: ParsedTransactionWithMeta
): Generator<ParsedInstruction> {
  // Top-level parsed instructions
  const top = tx.transaction.message
    .instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
  for (const ix of top) {
    if ("parsed" in ix) yield ix as ParsedInstruction;
  }

  // Inner parsed instructions
  const inners = tx.meta?.innerInstructions ?? [];
  for (const inner of inners) {
    const list = inner
      .instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
    for (const ix of list) {
      if ("parsed" in ix) yield ix as ParsedInstruction;
    }
  }
}

function isSystemTransfer(ix: ParsedInstruction): boolean {
  return ix.program === "system" && (ix.parsed as any)?.type === "transfer";
}

function extractTransfer(ix: ParsedInstruction): ParsedSysTransfer | null {
  if (!isSystemTransfer(ix)) return null;
  const info: any = ix.parsed.info;
  const from = info?.source;
  const to = info?.destination;
  const lamports = info?.lamports;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    (typeof lamports !== "number" && typeof lamports !== "string")
  ) {
    return null;
  }
  return { from, to, lamports: Number(lamports) };
}

export function findAnyTransfer(
  tx: ParsedTransactionWithMeta
): ParsedSysTransfer | null {
  for (const ix of allParsedInstructions(tx)) {
    const t = extractTransfer(ix);
    if (t) return t;
  }
  return null;
}

export function findTransferToDest(
  tx: ParsedTransactionWithMeta,
  destBase58: string
): ParsedSysTransfer | null {
  for (const ix of allParsedInstructions(tx)) {
    const t = extractTransfer(ix);
    if (t && t.to === destBase58) return t;
  }
  return null;
}

export function findTransferFromTo(
  tx: ParsedTransactionWithMeta,
  fromBase58: string,
  destBase58: string
): ParsedSysTransfer | null {
  for (const ix of allParsedInstructions(tx)) {
    const t = extractTransfer(ix);
    if (t && t.from === fromBase58 && t.to === destBase58) return t;
  }
  return null;
}