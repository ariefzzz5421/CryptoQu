/**
 * Turns a raw QRIS string into a structured merchant + transaction record.
 *
 * Everything downstream (quoting, routing, risk, receipts) reads this shape and
 * never touches the raw payload again.
 */

import { verifyChecksum } from "./crc";
import { decodeTlv, getPath, tagValue, type TlvNode, TlvParseError } from "./tlv";
import {
  COUNTRY_ID,
  CURRENCY_IDR,
  POI_DYNAMIC,
  POI_STATIC,
  describeAcquirer,
  describeMcc,
  MERCHANT_CRITERIA,
} from "./registry";

export interface MerchantAccount {
  /** Template tag the account was found under (26-51). */
  tag: string;
  /** Sub-tag 00 — reverse-DNS acquirer identifier. */
  guid: string;
  acquirer: string;
  /** Sub-tag 01 — merchant PAN, present on acquirer templates. */
  pan?: string;
  /** Sub-tag 02 — merchant ID at that acquirer, or the NMID on the national template. */
  merchantId?: string;
  /** Sub-tag 03 — merchant size classification. */
  criteria?: string;
  criteriaLabel?: string;
}

export interface AdditionalData {
  billNumber?: string;
  mobileNumber?: string;
  storeLabel?: string;
  loyaltyNumber?: string;
  referenceLabel?: string;
  customerLabel?: string;
  terminalLabel?: string;
  purpose?: string;
  consumerDataRequest?: string;
}

export type TipIndicator =
  | { kind: "none" }
  | { kind: "prompt" }
  | { kind: "fixed"; amountIdr: number }
  | { kind: "percentage"; percent: number };

export interface ParsedQris {
  raw: string;
  payloadFormat: string;
  /** True when tag 01 is "12" — an amount-bearing, single-use code. */
  dynamic: boolean;
  merchantName: string;
  merchantCity: string;
  postalCode?: string;
  countryCode: string;
  currency: string;
  /** Transaction amount in IDR from tag 54, when the code carries one. */
  amount?: number;
  tip: TipIndicator;
  mcc?: string;
  mccLabel: string;
  /** National Merchant ID from the ID.CO.QRIS.WWW template. */
  nmid?: string;
  /** Merchant classification driving the MDR tier. */
  criteria?: string;
  accounts: MerchantAccount[];
  additionalData: AdditionalData;
  crc: string;
  nodes: TlvNode[];
  warnings: string[];
}

export class QrisParseError extends Error {
  constructor(
    message: string,
    readonly code:
      | "empty"
      | "malformed"
      | "checksum"
      | "missing_field"
      | "unsupported",
  ) {
    super(message);
    this.name = "QrisParseError";
  }
}

const ADDITIONAL_DATA_KEYS: Record<string, keyof AdditionalData> = {
  "01": "billNumber",
  "02": "mobileNumber",
  "03": "storeLabel",
  "04": "loyaltyNumber",
  "05": "referenceLabel",
  "06": "customerLabel",
  "07": "terminalLabel",
  "08": "purpose",
  "09": "consumerDataRequest",
};

export interface ParseOptions {
  /**
   * Reject payloads whose tag-63 checksum does not match. Defaults to true —
   * turning it off is only useful for inspecting a code a scanner mangled.
   */
  enforceChecksum?: boolean;
}

export function parseQris(input: string, options: ParseOptions = {}): ParsedQris {
  const enforceChecksum = options.enforceChecksum ?? true;
  // Only surrounding whitespace and line breaks a scanner may have introduced are
  // removed. Interior spaces are significant — merchant names carry them, and
  // stripping one would invalidate the tag-63 checksum.
  const raw = input.trim().replace(/[\r\n\t]/g, "");
  if (!raw) throw new QrisParseError("payload is empty", "empty");

  const warnings: string[] = [];
  const checksumOk = verifyChecksum(raw);
  if (!checksumOk) {
    if (enforceChecksum) {
      throw new QrisParseError("tag 63 checksum does not match the payload", "checksum");
    }
    warnings.push("Tag 63 checksum does not match — the code may be damaged or hand-edited.");
  }

  let nodes: TlvNode[];
  try {
    nodes = decodeTlv(raw);
  } catch (error) {
    if (error instanceof TlvParseError) {
      throw new QrisParseError(`not a valid EMVCo payload: ${error.message}`, "malformed");
    }
    throw error;
  }

  const payloadFormat = tagValue(nodes, "00");
  if (payloadFormat !== "01") {
    warnings.push(`Unexpected payload format indicator "${payloadFormat ?? "missing"}" (expected 01).`);
  }

  const poi = tagValue(nodes, "01") ?? POI_STATIC;
  const merchantName = (tagValue(nodes, "59") ?? "").trim();
  const merchantCity = (tagValue(nodes, "60") ?? "").trim();
  const currency = tagValue(nodes, "53") ?? "";
  const countryCode = tagValue(nodes, "58") ?? "";

  if (!merchantName) throw new QrisParseError("tag 59 (merchant name) is missing", "missing_field");
  if (!currency) throw new QrisParseError("tag 53 (currency) is missing", "missing_field");
  if (currency !== CURRENCY_IDR) {
    warnings.push(`Currency ${currency} is not IDR (360) — this is not a domestic QRIS code.`);
  }
  if (countryCode && countryCode !== COUNTRY_ID) {
    warnings.push(`Country code ${countryCode} is outside Indonesia.`);
  }

  const amountRaw = tagValue(nodes, "54");
  let amount: number | undefined;
  if (amountRaw !== undefined) {
    const parsed = Number(amountRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new QrisParseError(`tag 54 amount "${amountRaw}" is not a valid number`, "malformed");
    }
    amount = parsed;
  }

  if (poi === POI_DYNAMIC && amount === undefined) {
    warnings.push("Code is flagged dynamic (tag 01 = 12) but carries no amount in tag 54.");
  }
  if (poi === POI_STATIC && amount !== undefined) {
    warnings.push("Code is flagged static (tag 01 = 11) yet carries an amount in tag 54.");
  }

  const accounts = readAccounts(nodes);
  const national = accounts.find((account) => account.guid === "ID.CO.QRIS.WWW");
  const criteria = national?.criteria ?? accounts.find((a) => a.criteria)?.criteria;

  if (accounts.length === 0) {
    throw new QrisParseError("no merchant account template (tags 26-51) present", "missing_field");
  }

  const mcc = tagValue(nodes, "52");

  return {
    raw,
    payloadFormat: payloadFormat ?? "",
    dynamic: poi === POI_DYNAMIC,
    merchantName,
    merchantCity,
    postalCode: tagValue(nodes, "61"),
    countryCode,
    currency,
    amount,
    tip: readTip(nodes, warnings),
    mcc,
    mccLabel: describeMcc(mcc),
    nmid: national?.merchantId,
    criteria,
    accounts,
    additionalData: readAdditionalData(nodes),
    crc: raw.slice(-4).toUpperCase(),
    nodes,
    warnings,
  };
}

/** Non-throwing variant for UI code that renders errors inline. */
export function tryParseQris(
  input: string,
  options?: ParseOptions,
): { ok: true; data: ParsedQris } | { ok: false; error: string; code: string } {
  try {
    return { ok: true, data: parseQris(input, options) };
  } catch (error) {
    if (error instanceof QrisParseError) return { ok: false, error: error.message, code: error.code };
    return { ok: false, error: (error as Error).message, code: "malformed" };
  }
}

function readAccounts(nodes: TlvNode[]): MerchantAccount[] {
  const accounts: MerchantAccount[] = [];
  for (const node of nodes) {
    const tagNumber = Number(node.tag);
    if (tagNumber < 26 || tagNumber > 51) continue;
    const children = node.children;
    if (!children) continue;

    const guid = (getPath(children, "00") ?? "").toUpperCase();
    if (!guid) continue;

    const criteria = getPath(children, "03");
    accounts.push({
      tag: node.tag,
      guid,
      acquirer: describeAcquirer(guid),
      pan: getPath(children, "01"),
      merchantId: getPath(children, "02"),
      criteria,
      criteriaLabel: criteria ? MERCHANT_CRITERIA[criteria.toUpperCase()]?.label : undefined,
    });
  }
  return accounts;
}

function readAdditionalData(nodes: TlvNode[]): AdditionalData {
  const template = nodes.find((node) => node.tag === "62");
  const out: AdditionalData = {};
  if (!template?.children) return out;
  for (const child of template.children) {
    const key = ADDITIONAL_DATA_KEYS[child.tag];
    if (key) out[key] = child.value;
  }
  return out;
}

function readTip(nodes: TlvNode[], warnings: string[]): TipIndicator {
  const indicator = tagValue(nodes, "55");
  if (!indicator) return { kind: "none" };

  if (indicator === "01") return { kind: "prompt" };

  if (indicator === "02") {
    const fixed = tagValue(nodes, "56");
    const value = Number(fixed);
    if (!fixed || !Number.isFinite(value)) {
      warnings.push("Tip indicator 02 set but tag 56 (fixed fee) is missing or invalid.");
      return { kind: "none" };
    }
    return { kind: "fixed", amountIdr: value };
  }

  if (indicator === "03") {
    const percent = tagValue(nodes, "57");
    const value = Number(percent);
    if (!percent || !Number.isFinite(value)) {
      warnings.push("Tip indicator 03 set but tag 57 (percentage fee) is missing or invalid.");
      return { kind: "none" };
    }
    return { kind: "percentage", percent: value };
  }

  warnings.push(`Unknown tip indicator "${indicator}" in tag 55.`);
  return { kind: "none" };
}

/**
 * Total the payer owes: the base amount plus any convenience fee the merchant
 * encoded. Rounded to whole rupiah, which is the smallest unit QRIS settles in.
 */
export function computeTotalIdr(parsed: ParsedQris, overrideAmount?: number): number {
  const base = overrideAmount ?? parsed.amount ?? 0;
  let fee = 0;
  if (parsed.tip.kind === "fixed") fee = parsed.tip.amountIdr;
  if (parsed.tip.kind === "percentage") fee = (base * parsed.tip.percent) / 100;
  return Math.round(base + fee);
}
