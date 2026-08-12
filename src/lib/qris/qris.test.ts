import { describe, expect, it } from "vitest";

import { crc16ccitt, crc16ccittHex, verifyChecksum, withChecksum } from "./crc";
import { decodeTlv, encodeTlv, getPath, TlvParseError } from "./tlv";
import { computeTotalIdr, parseQris, QrisParseError, tryParseQris } from "./parse";
import { mintQris, QrisBuildError, toDynamicQris, toStaticQris } from "./build";
import { resolveMdr } from "./registry";

/**
 * A static merchant code assembled from the spec's field definitions. The body
 * is written out by hand so the parser is checked against the layout, not
 * against our own builder.
 */
const STATIC_BODY =
  "000201" +
  "010211" +
  "26630017ID.CO.BANKBCA.WWW011893600014000123456702099000012340303UMI" +
  "51440014ID.CO.QRIS.WWW0215ID10243123412340303UMI" +
  "52045812" +
  "5303360" +
  "5802ID" +
  "5916WARUNG SEDERHANA" +
  "6008SURABAYA" +
  "610560111" +
  "62080304TOKO";
const STATIC_QRIS = withChecksum(STATIC_BODY);

describe("CRC-16/CCITT-FALSE", () => {
  it("matches the published check vector", () => {
    // The canonical check value for this CRC variant.
    expect(crc16ccitt("123456789")).toBe(0x29b1);
    expect(crc16ccittHex("123456789")).toBe("29B1");
  });

  it("always emits four hex digits", () => {
    for (const sample of ["a", "abc", "0002010102", "x".repeat(200)]) {
      expect(crc16ccittHex(sample)).toMatch(/^[0-9A-F]{4}$/);
    }
  });

  it("round-trips through withChecksum/verifyChecksum", () => {
    expect(verifyChecksum(STATIC_QRIS)).toBe(true);
  });

  it("rejects a payload whose body was altered", () => {
    const tampered = STATIC_QRIS.replace("SURABAYA", "BANDUNGX");
    expect(verifyChecksum(tampered)).toBe(false);
  });

  it("rejects a payload that does not end with a 6304 header", () => {
    expect(verifyChecksum("000201ABCD")).toBe(false);
  });
});

describe("TLV codec", () => {
  it("decodes tag/length/value triplets in order", () => {
    const nodes = decodeTlv("000201010211");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ tag: "00", length: 2, value: "01" });
    expect(nodes[1]).toMatchObject({ tag: "01", length: 2, value: "11" });
  });

  it("recurses into template tags", () => {
    const nodes = decodeTlv(STATIC_BODY);
    expect(getPath(nodes, "51", "00")).toBe("ID.CO.QRIS.WWW");
    expect(getPath(nodes, "51", "02")).toBe("ID1024312341234");
    expect(getPath(nodes, "26", "00")).toBe("ID.CO.BANKBCA.WWW");
  });

  it("leaves free-text fields unparsed", () => {
    const nodes = decodeTlv(STATIC_BODY);
    const name = nodes.find((n) => n.tag === "59");
    expect(name?.children).toBeUndefined();
    expect(name?.value).toBe("WARUNG SEDERHANA");
  });

  it("re-encodes to the exact input", () => {
    expect(encodeTlv(decodeTlv(STATIC_BODY))).toBe(STATIC_BODY);
  });

  it("throws on a length that runs past the end of the payload", () => {
    expect(() => decodeTlv("0099ab")).toThrow(TlvParseError);
  });

  it("throws on a non-numeric header", () => {
    expect(() => decodeTlv("XX02ab")).toThrow(TlvParseError);
  });
});

describe("parseQris", () => {
  it("extracts merchant identity from a static code", () => {
    const parsed = parseQris(STATIC_QRIS);
    expect(parsed.dynamic).toBe(false);
    expect(parsed.merchantName).toBe("WARUNG SEDERHANA");
    expect(parsed.merchantCity).toBe("SURABAYA");
    expect(parsed.postalCode).toBe("60111");
    expect(parsed.currency).toBe("360");
    expect(parsed.countryCode).toBe("ID");
    expect(parsed.nmid).toBe("ID1024312341234");
    expect(parsed.criteria).toBe("UMI");
    expect(parsed.mcc).toBe("5812");
    expect(parsed.mccLabel).toMatch(/Restaurant/i);
    expect(parsed.amount).toBeUndefined();
    expect(parsed.warnings).toHaveLength(0);
  });

  it("lists every acquirer template with a readable name", () => {
    const parsed = parseQris(STATIC_QRIS);
    expect(parsed.accounts).toHaveLength(2);
    expect(parsed.accounts.map((a) => a.acquirer)).toContain("Bank Central Asia");
    expect(parsed.accounts.map((a) => a.acquirer)).toContain("QRIS National Repository");
  });

  it("reads the additional data template", () => {
    const parsed = parseQris(STATIC_QRIS);
    expect(parsed.additionalData.storeLabel).toBe("TOKO");
  });

  it("rejects a bad checksum by default and tolerates it on request", () => {
    const tampered = STATIC_QRIS.slice(0, -4) + "0000";
    expect(() => parseQris(tampered)).toThrow(QrisParseError);
    const parsed = parseQris(tampered, { enforceChecksum: false });
    expect(parsed.warnings.join(" ")).toMatch(/checksum/i);
  });

  it("reports failures without throwing via tryParseQris", () => {
    const result = tryParseQris("not-a-qris");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("checksum");
  });

  it("flags a code missing the merchant account template", () => {
    const body = "000201010211" + "5303360" + "5802ID" + "5904TOKO" + "6006JAKART";
    expect(() => parseQris(withChecksum(body))).toThrow(/merchant account/i);
  });
});

describe("static to dynamic conversion", () => {
  it("writes the amount, flips the POI, and re-checksums", () => {
    const dynamic = toDynamicQris(STATIC_QRIS, { amountIdr: 25_000 });
    expect(verifyChecksum(dynamic)).toBe(true);

    const parsed = parseQris(dynamic);
    expect(parsed.dynamic).toBe(true);
    expect(parsed.amount).toBe(25_000);
    expect(parsed.crc).not.toBe(parseQris(STATIC_QRIS).crc);
  });

  it("preserves merchant identity across the conversion", () => {
    const before = parseQris(STATIC_QRIS);
    const after = parseQris(toDynamicQris(STATIC_QRIS, { amountIdr: 1_000 }));
    expect(after.merchantName).toBe(before.merchantName);
    expect(after.nmid).toBe(before.nmid);
    expect(after.accounts).toHaveLength(before.accounts.length);
    expect(after.mcc).toBe(before.mcc);
  });

  it("encodes a fixed convenience fee as tags 55/56", () => {
    const parsed = parseQris(toDynamicQris(STATIC_QRIS, { amountIdr: 10_000, feeFixedIdr: 1_000 }));
    expect(parsed.tip).toEqual({ kind: "fixed", amountIdr: 1_000 });
    expect(computeTotalIdr(parsed)).toBe(11_000);
  });

  it("encodes a percentage convenience fee as tags 55/57", () => {
    const parsed = parseQris(toDynamicQris(STATIC_QRIS, { amountIdr: 200_000, feePercent: 5 }));
    expect(parsed.tip).toEqual({ kind: "percentage", percent: 5 });
    expect(computeTotalIdr(parsed)).toBe(210_000);
  });

  it("never leaves a stale fee tag behind when the fee type changes", () => {
    const fixed = toDynamicQris(STATIC_QRIS, { amountIdr: 10_000, feeFixedIdr: 500 });
    const percent = toDynamicQris(fixed, { amountIdr: 10_000, feePercent: 2 });
    const topLevelTags = decodeTlv(percent).map((n) => n.tag);
    expect(topLevelTags).toContain("57");
    expect(topLevelTags).not.toContain("56");
    expect(parseQris(percent).tip).toEqual({ kind: "percentage", percent: 2 });
  });

  it("merges the reference label used for settlement reconciliation", () => {
    const parsed = parseQris(
      toDynamicQris(STATIC_QRIS, { amountIdr: 5_000, referenceLabel: "CQ-INV-001" }),
    );
    expect(parsed.additionalData.referenceLabel).toBe("CQ-INV-001");
    // The store label already present on the source code survives the merge.
    expect(parsed.additionalData.storeLabel).toBe("TOKO");
  });

  it("refuses both fee types at once and rejects bad amounts", () => {
    expect(() => toDynamicQris(STATIC_QRIS, { amountIdr: 1, feeFixedIdr: 1, feePercent: 1 })).toThrow(
      QrisBuildError,
    );
    expect(() => toDynamicQris(STATIC_QRIS, { amountIdr: 0 })).toThrow(QrisBuildError);
    expect(() => toDynamicQris(STATIC_QRIS, { amountIdr: -5 })).toThrow(QrisBuildError);
    expect(() => toDynamicQris(STATIC_QRIS, { amountIdr: 1e12 })).toThrow(QrisBuildError);
  });

  it("reverts a dynamic code back to static", () => {
    const dynamic = toDynamicQris(STATIC_QRIS, { amountIdr: 42_000, feeFixedIdr: 1_000 });
    const back = parseQris(toStaticQris(dynamic));
    expect(back.dynamic).toBe(false);
    expect(back.amount).toBeUndefined();
    expect(back.tip.kind).toBe("none");
  });
});

describe("mintQris", () => {
  it("produces a scannable static code for a directly acquired merchant", () => {
    const payload = mintQris({
      merchantName: "Kopi Senja",
      merchantCity: "Bandung",
      nmid: "ID1024312341234",
      mcc: "5812",
      criteria: "UMI",
    });
    expect(verifyChecksum(payload)).toBe(true);

    const parsed = parseQris(payload);
    expect(parsed.merchantName).toBe("Kopi Senja");
    expect(parsed.dynamic).toBe(false);
    expect(parsed.nmid).toBe("ID1024312341234");
  });

  it("produces a dynamic code when an amount is supplied", () => {
    const parsed = parseQris(
      mintQris({
        merchantName: "Kopi Senja",
        merchantCity: "Bandung",
        nmid: "ID1024312341234",
        amountIdr: 18_000,
        referenceLabel: "CQ-9F2A",
      }),
    );
    expect(parsed.dynamic).toBe(true);
    expect(parsed.amount).toBe(18_000);
    expect(parsed.additionalData.referenceLabel).toBe("CQ-9F2A");
  });

  it("strips characters a scanner cannot represent and caps field length", () => {
    const parsed = parseQris(
      mintQris({
        merchantName: "Café Ω Nusantara Rasa Sejati Sekali",
        merchantCity: "Yogyakarta Istimewa",
        nmid: "ID1024312341234",
      }),
    );
    expect(parsed.merchantName).toBe("Cafe  Nusantara Rasa Seja");
    expect(parsed.merchantName.length).toBeLessThanOrEqual(25);
    expect(parsed.merchantCity.length).toBeLessThanOrEqual(15);
  });

  it("validates the NMID shape", () => {
    expect(() =>
      mintQris({ merchantName: "A", merchantCity: "B", nmid: "NOT-AN-NMID" }),
    ).toThrow(QrisBuildError);
  });
});

describe("MDR schedule", () => {
  it("charges nothing to a micro merchant under the threshold", () => {
    expect(resolveMdr("UMI", 400_000).bps).toBe(0);
  });

  it("charges 0.3% to a micro merchant above the threshold", () => {
    expect(resolveMdr("UMI", 750_000).bps).toBe(30);
  });

  it("charges 0.7% to larger merchants and to unclassified ones", () => {
    expect(resolveMdr("UKE", 10_000).bps).toBe(70);
    expect(resolveMdr(undefined, 10_000).bps).toBe(70);
  });
});
