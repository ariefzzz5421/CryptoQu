/**
 * QRIS payload construction: promoting a static code to a dynamic (amount
 * bearing) one, and minting a code from scratch for merchants onboarded
 * directly onto CryptoQu.
 */

import { withChecksum } from "./crc";
import { decodeTlv, encodeTlv, sortByTag, upsertTag, type TlvNode } from "./tlv";
import { parseQris, type ParsedQris } from "./parse";
import { COUNTRY_ID, CURRENCY_IDR, POI_DYNAMIC, POI_STATIC } from "./registry";

export interface DynamicOptions {
  /** Transaction amount in whole rupiah. Must be positive. */
  amountIdr: number;
  /** Fixed convenience fee in rupiah — encoded as tag 55="02" + tag 56. */
  feeFixedIdr?: number;
  /** Percentage convenience fee — encoded as tag 55="03" + tag 57. */
  feePercent?: number;
  /** Tag 62 sub-tag 01. */
  billNumber?: string;
  /** Tag 62 sub-tag 05 — what CryptoQu reconciles settlement against. */
  referenceLabel?: string;
  /** Tag 62 sub-tag 07. */
  terminalLabel?: string;
  /** Tag 62 sub-tag 03. */
  storeLabel?: string;
}

export class QrisBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrisBuildError";
  }
}

const MAX_QRIS_AMOUNT_IDR = 100_000_000_000; // 13-char tag 54 ceiling with 2 decimals.

/**
 * Converts a static QRIS payload into a dynamic one carrying an amount.
 *
 * Steps, in the order EMVCo requires: flip tag 01 to "12", write tag 54, write
 * the convenience-fee tags, merge tag 62, drop the old checksum, re-sort and
 * recompute tag 63 over the new body.
 */
export function toDynamicQris(source: string | ParsedQris, options: DynamicOptions): string {
  const parsed = typeof source === "string" ? parseQris(source) : source;
  assertAmount(options.amountIdr);

  if (options.feeFixedIdr !== undefined && options.feePercent !== undefined) {
    throw new QrisBuildError("a code can carry a fixed fee or a percentage fee, not both");
  }

  let nodes: TlvNode[] = parsed.nodes.filter((node) => node.tag !== "63");
  nodes = upsertTag(nodes, "01", POI_DYNAMIC);
  nodes = upsertTag(nodes, "54", formatAmount(options.amountIdr));

  // Rewrite the fee tags as a set so a leftover 56 never survives a switch to 57.
  nodes = upsertTag(nodes, "55", undefined);
  nodes = upsertTag(nodes, "56", undefined);
  nodes = upsertTag(nodes, "57", undefined);
  if (options.feeFixedIdr !== undefined) {
    assertAmount(options.feeFixedIdr, { allowZero: true });
    nodes = upsertTag(nodes, "55", "02");
    nodes = upsertTag(nodes, "56", formatAmount(options.feeFixedIdr));
  } else if (options.feePercent !== undefined) {
    if (options.feePercent < 0 || options.feePercent > 100) {
      throw new QrisBuildError("percentage fee must be between 0 and 100");
    }
    nodes = upsertTag(nodes, "55", "03");
    nodes = upsertTag(nodes, "57", trimNumber(options.feePercent));
  }

  const additional = buildAdditionalData(parsed.nodes, options);
  nodes = upsertTag(nodes, "62", undefined);
  if (additional) nodes = [...nodes, additional];

  return withChecksum(encodeTlv(sortByTag(nodes)));
}

/** Strips the amount and fee tags, returning the code to reusable static form. */
export function toStaticQris(source: string | ParsedQris): string {
  const parsed = typeof source === "string" ? parseQris(source) : source;
  let nodes = parsed.nodes.filter((node) => node.tag !== "63");
  nodes = upsertTag(nodes, "01", POI_STATIC);
  for (const tag of ["54", "55", "56", "57"]) nodes = upsertTag(nodes, tag, undefined);
  return withChecksum(encodeTlv(sortByTag(nodes)));
}

export interface MintOptions {
  merchantName: string;
  merchantCity: string;
  /** National Merchant ID, e.g. ID1024312341234. */
  nmid: string;
  merchantId?: string;
  mcc?: string;
  criteria?: string;
  postalCode?: string;
  /** Omit for a static code; supply to mint a dynamic one. */
  amountIdr?: number;
  referenceLabel?: string;
  terminalLabel?: string;
  storeLabel?: string;
  /** Acquirer GUID for the merchant template. Defaults to the national repository. */
  guid?: string;
}

/**
 * Builds a QRIS payload for a merchant CryptoQu acquires directly. The output
 * is a spec-shaped code any Indonesian wallet can decode.
 */
export function mintQris(options: MintOptions): string {
  const name = sanitise(options.merchantName, 25);
  const city = sanitise(options.merchantCity, 15);
  if (!name) throw new QrisBuildError("merchant name is required");
  if (!city) throw new QrisBuildError("merchant city is required");
  if (!/^ID\d{13,15}$/i.test(options.nmid)) {
    throw new QrisBuildError('NMID must look like "ID" followed by 13-15 digits');
  }

  const accountChildren: TlvNode[] = [
    node("00", (options.guid ?? "ID.CO.QRIS.WWW").toUpperCase()),
    node("01", options.merchantId ?? options.nmid),
    node("02", options.nmid.toUpperCase()),
    node("03", (options.criteria ?? "UMI").toUpperCase()),
  ];

  const nodes: TlvNode[] = [
    node("00", "01"),
    node("01", options.amountIdr === undefined ? POI_STATIC : POI_DYNAMIC),
    { tag: "51", length: 0, value: "", children: accountChildren },
    node("52", options.mcc ?? "0000"),
    node("53", CURRENCY_IDR),
    node("58", COUNTRY_ID),
    node("59", name),
    node("60", city),
  ];

  if (options.amountIdr !== undefined) {
    assertAmount(options.amountIdr);
    nodes.push(node("54", formatAmount(options.amountIdr)));
  }
  if (options.postalCode) nodes.push(node("61", sanitise(options.postalCode, 10)));

  const additionalChildren = additionalChildrenFrom({}, options);
  if (additionalChildren.length > 0) {
    nodes.push({ tag: "62", length: 0, value: "", children: additionalChildren });
  }

  return withChecksum(encodeTlv(sortByTag(nodes)));
}

function buildAdditionalData(
  original: TlvNode[],
  options: DynamicOptions,
): TlvNode | undefined {
  const existing: Record<string, string> = {};
  const template = original.find((n) => n.tag === "62");
  if (template?.children) {
    for (const child of template.children) existing[child.tag] = child.value;
  }
  const children = additionalChildrenFrom(existing, options);
  if (children.length === 0) return undefined;
  return { tag: "62", length: 0, value: "", children };
}

function additionalChildrenFrom(
  existing: Record<string, string>,
  options: Pick<DynamicOptions, "billNumber" | "referenceLabel" | "terminalLabel" | "storeLabel">,
): TlvNode[] {
  const merged: Record<string, string> = { ...existing };
  if (options.billNumber) merged["01"] = sanitise(options.billNumber, 25);
  if (options.storeLabel) merged["03"] = sanitise(options.storeLabel, 25);
  if (options.referenceLabel) merged["05"] = sanitise(options.referenceLabel, 25);
  if (options.terminalLabel) merged["07"] = sanitise(options.terminalLabel, 25);

  return Object.keys(merged)
    .sort((a, b) => Number(a) - Number(b))
    .filter((tag) => merged[tag] !== "")
    .map((tag) => node(tag, merged[tag]));
}

function node(tag: string, value: string): TlvNode {
  return { tag, length: value.length, value };
}

/**
 * Tag 54 is a numeric string; QRIS settles in whole rupiah so we round rather
 * than emit sub-rupiah precision an acquirer would truncate anyway.
 */
function formatAmount(amountIdr: number): string {
  return String(Math.round(amountIdr));
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

function assertAmount(amount: number, opts: { allowZero?: boolean } = {}): void {
  if (!Number.isFinite(amount)) throw new QrisBuildError("amount must be a finite number");
  if (amount < 0) throw new QrisBuildError("amount must not be negative");
  if (!opts.allowZero && amount <= 0) throw new QrisBuildError("amount must be greater than zero");
  if (amount >= MAX_QRIS_AMOUNT_IDR) throw new QrisBuildError("amount exceeds the QRIS field ceiling");
}

/** QRIS fields are ASCII-only and length-capped; strip anything that would break a scanner. */
function sanitise(value: string, maxLength: number): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, maxLength);
}

/** Re-exports the raw TLV view for debugging tools in the dashboard. */
export function explain(payload: string): TlvNode[] {
  return decodeTlv(payload.trim());
}
