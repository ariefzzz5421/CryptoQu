/**
 * Sample codes used by the checkout demo, the docs and the merchant console.
 *
 * They are minted through the same builder the API uses, so the payloads on
 * screen are real, checksum-valid QRIS codes rather than fixtures that only
 * look like one.
 */

import { mintQris } from "@/lib/qris";

export interface DemoMerchant {
  key: string;
  label: string;
  description: string;
  payload: string;
  /** Present when the code is dynamic. */
  amountIdr?: number;
}

export const DEMO_CODES: DemoMerchant[] = [
  {
    key: "kopi-senja",
    label: "Kopi Senja — static",
    description: "A micro merchant's reusable counter code. The payer enters the amount.",
    payload: mintQris({
      merchantName: "Kopi Senja",
      merchantCity: "Bandung",
      nmid: "ID1024312341234",
      mcc: "5812",
      criteria: "UMI",
      storeLabel: "COUNTER-1",
    }),
  },
  {
    key: "warung-bu-sri",
    label: "Warung Bu Sri — dynamic Rp 27.500",
    description: "A POS-generated code with the amount already fixed in tag 54.",
    amountIdr: 27_500,
    payload: mintQris({
      merchantName: "Warung Bu Sri",
      merchantCity: "Surabaya",
      nmid: "ID1098877665544",
      mcc: "5814",
      criteria: "UMI",
      amountIdr: 27_500,
      referenceLabel: "INV-77120",
      terminalLabel: "POS-03",
    }),
  },
  {
    key: "toko-elektronik",
    label: "Sinar Elektronik — dynamic Rp 4.250.000",
    description: "A larger ticket at a small enterprise, where the 0.7% MDR tier applies.",
    amountIdr: 4_250_000,
    payload: mintQris({
      merchantName: "Sinar Elektronik",
      merchantCity: "Jakarta",
      nmid: "ID1055512340987",
      mcc: "5732",
      criteria: "UKE",
      amountIdr: 4_250_000,
      referenceLabel: "SO-2291",
    }),
  },
];

export const DEFAULT_DEMO = DEMO_CODES[0];
