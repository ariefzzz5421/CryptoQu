/**
 * Lookup tables that turn raw QRIS codes into something a human (or a risk
 * engine) can read: acquirer GUIDs, merchant size criteria, and the ISO 18245
 * merchant category codes that actually show up on Indonesian QR codes.
 */

/** Point of Initiation Method — tag 01. */
export const POI_STATIC = "11";
export const POI_DYNAMIC = "12";

/** ISO 4217 numeric for Indonesian Rupiah — tag 53 on every domestic QRIS. */
export const CURRENCY_IDR = "360";
export const COUNTRY_ID = "ID";

/**
 * Merchant criteria (sub-tag 03 of the merchant account template). Bank
 * Indonesia ties the MDR tier to this classification, so the payment router
 * reads it to price a transaction.
 */
export const MERCHANT_CRITERIA: Record<string, { label: string; english: string }> = {
  UMI: { label: "Usaha Mikro", english: "Micro enterprise" },
  UKE: { label: "Usaha Kecil", english: "Small enterprise" },
  UME: { label: "Usaha Menengah", english: "Medium enterprise" },
  UBE: { label: "Usaha Besar", english: "Large enterprise" },
  URE: { label: "Usaha Reguler", english: "Regular / non-classified" },
};

export type MerchantCriteria = keyof typeof MERCHANT_CRITERIA;

/**
 * Globally Unique Identifiers seen in sub-tag 00 of templates 26-51. The
 * domestic central repository (`ID.CO.QRIS.WWW`) is the one that carries the
 * NMID; the others are acquirer-specific mirrors of the same merchant.
 */
export const ACQUIRER_GUIDS: Record<string, string> = {
  "ID.CO.QRIS.WWW": "QRIS National Repository",
  "ID.CO.BANKBCA.WWW": "Bank Central Asia",
  "ID.CO.BNI.WWW": "Bank Negara Indonesia",
  "ID.CO.BRI.WWW": "Bank Rakyat Indonesia",
  "ID.CO.MANDIRI.WWW": "Bank Mandiri",
  "ID.CO.PERMATABANK.WWW": "Permata Bank",
  "ID.CO.CIMBNIAGA.WWW": "CIMB Niaga",
  "ID.CO.BSI.WWW": "Bank Syariah Indonesia",
  "ID.CO.SHOPEE.WWW": "ShopeePay",
  "COM.SHOPEE.WWW": "ShopeePay",
  "ID.CO.GOJEK.WWW": "GoPay",
  "COM.GO-JEK.WWW": "GoPay",
  "ID.CO.OVO.WWW": "OVO",
  "COM.OVO.WWW": "OVO",
  "ID.CO.DANA.WWW": "DANA",
  "ID.CO.LINKAJA.WWW": "LinkAja",
  "ID.CO.ESPAY.WWW": "DANA / Espay",
  "ID.CO.NOBUBANK.WWW": "Nobu Bank",
  "ID.CO.NETZME.WWW": "Netzme",
  "ID.CO.SAKUKU.WWW": "Sakuku",
  "ID.CO.TELKOM.WWW": "Telkom / LinkAja",
};

/** Merchant category codes commonly present on QRIS acceptance points. */
export const MERCHANT_CATEGORY_CODES: Record<string, string> = {
  "0000": "Uncategorised merchant",
  "4111": "Local transport & commuter",
  "4121": "Taxi & ride hailing",
  "4816": "Digital & network services",
  "4899": "Cable & streaming services",
  "4900": "Utilities — electricity, water, gas",
  "5192": "Books & newspapers",
  "5311": "Department stores",
  "5411": "Grocery stores & supermarkets",
  "5451": "Dairy & fresh produce",
  "5462": "Bakeries",
  "5499": "Convenience stores & minimarket",
  "5541": "Fuel stations",
  "5651": "Clothing & apparel",
  "5661": "Footwear",
  "5691": "Fashion retail",
  "5732": "Electronics retail",
  "5812": "Restaurants & warung makan",
  "5814": "Fast food & quick service",
  "5912": "Pharmacies & apotek",
  "5941": "Sporting goods",
  "5945": "Toys & hobby",
  "5977": "Cosmetics & personal care",
  "5992": "Florists",
  "5999": "Specialty retail",
  "7011": "Hotels & lodging",
  "7230": "Salon & barbershop",
  "7299": "Personal services",
  "7994": "Gaming & e-sports",
  "8011": "Doctors & clinics",
  "8021": "Dental services",
  "8062": "Hospitals",
  "8211": "Schools",
  "8220": "Universities",
  "8398": "Charity & donations",
  "8999": "Professional services",
};

export function describeMcc(mcc: string | undefined): string {
  if (!mcc) return "Not specified";
  return MERCHANT_CATEGORY_CODES[mcc] ?? `Category ${mcc}`;
}

export function describeAcquirer(guid: string | undefined): string {
  if (!guid) return "Unknown acquirer";
  return ACQUIRER_GUIDS[guid.toUpperCase()] ?? guid;
}

/**
 * Merchant Discount Rate schedule published by Bank Indonesia, expressed in
 * basis points. The fee is borne by the merchant and must not be passed to the
 * consumer, so it never touches the amount the payer is quoted — it only
 * affects what the merchant nets at settlement.
 */
export interface MdrTier {
  criteria: MerchantCriteria | "DEFAULT";
  /** Applies when the transaction is at or below this amount (IDR). */
  upToIdr?: number;
  bps: number;
  note: string;
}

export const MDR_SCHEDULE: MdrTier[] = [
  { criteria: "UMI", upToIdr: 500_000, bps: 0, note: "Micro merchant, transaction ≤ Rp500.000" },
  { criteria: "UMI", bps: 30, note: "Micro merchant, transaction > Rp500.000" },
  { criteria: "UKE", bps: 70, note: "Small enterprise" },
  { criteria: "UME", bps: 70, note: "Medium enterprise" },
  { criteria: "UBE", bps: 70, note: "Large enterprise" },
  { criteria: "URE", bps: 70, note: "Regular merchant" },
  { criteria: "DEFAULT", bps: 70, note: "Unclassified merchant" },
];

/** Resolves the MDR tier for a merchant classification and ticket size. */
export function resolveMdr(criteria: string | undefined, amountIdr: number): MdrTier {
  const key = (criteria ?? "").toUpperCase();
  const candidates = MDR_SCHEDULE.filter((tier) => tier.criteria === key);
  for (const tier of candidates) {
    if (tier.upToIdr === undefined || amountIdr <= tier.upToIdr) return tier;
  }
  return MDR_SCHEDULE[MDR_SCHEDULE.length - 1];
}
