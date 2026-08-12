/**
 * EMVCo TLV codec.
 *
 * A Merchant-Presented QR payload is a flat string of `[tag:2][len:2][value:len]`
 * records. Some tags (26-51, 62, 64, 80-99) carry nested records using the same
 * grammar, which is why decoding is recursive over an explicit template list.
 */

export interface TlvNode {
  tag: string;
  length: number;
  value: string;
  /** Present only for template tags whose value parsed cleanly as nested TLV. */
  children?: TlvNode[];
}

/** Tags whose value is itself a TLV sequence. */
export const TEMPLATE_TAGS: ReadonlySet<string> = new Set([
  // Merchant Account Information templates (domestic + acquirer specific).
  ...range(2, 51),
  "62", // Additional Data Field Template
  "64", // Merchant Information — Language Template
  ...range(80, 99), // Unreserved templates
]);

function range(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i).padStart(2, "0"));
  return out;
}

export class TlvParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "TlvParseError";
  }
}

const DIGITS = /^\d{2}$/;

/**
 * Decodes a TLV string. `depth` guards against a hostile payload that nests
 * templates into each other forever.
 */
export function decodeTlv(input: string, depth = 0): TlvNode[] {
  const nodes: TlvNode[] = [];
  let i = 0;

  while (i < input.length) {
    if (i + 4 > input.length) {
      throw new TlvParseError(`truncated record: need 4 header chars, found ${input.length - i}`, i);
    }
    const tag = input.slice(i, i + 2);
    const lengthRaw = input.slice(i + 2, i + 4);
    if (!DIGITS.test(tag)) throw new TlvParseError(`tag "${tag}" is not two digits`, i);
    if (!DIGITS.test(lengthRaw)) throw new TlvParseError(`length "${lengthRaw}" is not two digits`, i + 2);

    const length = Number(lengthRaw);
    const start = i + 4;
    const end = start + length;
    if (end > input.length) {
      throw new TlvParseError(
        `tag ${tag} declares length ${length} but only ${input.length - start} chars remain`,
        i,
      );
    }

    const value = input.slice(start, end);
    const node: TlvNode = { tag, length, value };

    if (depth < 4 && TEMPLATE_TAGS.has(tag) && looksLikeTlv(value)) {
      try {
        node.children = decodeTlv(value, depth + 1);
      } catch {
        // A template that fails to parse is kept as an opaque value rather than
        // failing the whole payload — acquirers do occasionally ship odd data.
      }
    }

    nodes.push(node);
    i = end;
  }

  return nodes;
}

/** Cheap pre-check so we do not try to recurse into free text like a merchant name. */
function looksLikeTlv(value: string): boolean {
  if (value.length < 4) return false;
  return DIGITS.test(value.slice(0, 2)) && DIGITS.test(value.slice(2, 4));
}

/** Serialises one record. Throws when the value exceeds the 99-char TLV ceiling. */
export function encodeTlvRecord(tag: string, value: string): string {
  if (!DIGITS.test(tag)) throw new Error(`invalid tag "${tag}"`);
  if (value.length > 99) throw new Error(`tag ${tag} value is ${value.length} chars, max is 99`);
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/** Serialises a node list, recursing into `children` when present. */
export function encodeTlv(nodes: TlvNode[]): string {
  return nodes
    .map((node) => encodeTlvRecord(node.tag, node.children ? encodeTlv(node.children) : node.value))
    .join("");
}

/** First node with `tag`, or undefined. Tags are unique in a well-formed payload. */
export function findTag(nodes: TlvNode[], tag: string): TlvNode | undefined {
  return nodes.find((node) => node.tag === tag);
}

export function tagValue(nodes: TlvNode[], tag: string): string | undefined {
  return findTag(nodes, tag)?.value;
}

/** Nested lookup: `getPath(nodes, "62", "05")` reads the reference label. */
export function getPath(nodes: TlvNode[], ...path: string[]): string | undefined {
  let current: TlvNode[] | undefined = nodes;
  let node: TlvNode | undefined;
  for (const tag of path) {
    if (!current) return undefined;
    node = findTag(current, tag);
    if (!node) return undefined;
    current = node.children;
  }
  return node?.value;
}

/**
 * Replaces (or inserts) a top-level tag, keeping records in ascending tag order
 * so the resulting payload matches what acquirers emit.
 */
export function upsertTag(nodes: TlvNode[], tag: string, value: string | undefined): TlvNode[] {
  const rest = nodes.filter((node) => node.tag !== tag);
  if (value === undefined) return sortByTag(rest);
  return sortByTag([...rest, { tag, length: value.length, value }]);
}

export function sortByTag(nodes: TlvNode[]): TlvNode[] {
  return [...nodes].sort((a, b) => Number(a.tag) - Number(b.tag));
}
