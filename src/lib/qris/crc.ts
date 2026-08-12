/**
 * CRC-16/CCITT-FALSE — the checksum EMVCo mandates for tag 63 of a
 * Merchant-Presented QR payload (and therefore for every QRIS code).
 *
 * Parameters: width=16, poly=0x1021, init=0xFFFF, refin=false, refout=false,
 * xorout=0x0000. Check value for "123456789" is 0x29B1.
 */

const POLY = 0x1021;

/** Precomputed byte table — the payloads are short but this runs per keystroke in the UI. */
const TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ POLY) & 0xffff : (crc << 1) & 0xffff;
    }
    table[i] = crc;
  }
  return table;
})();

/** Returns the CRC of `input` as a number in the range 0..0xFFFF. */
export function crc16ccitt(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xff;
    crc = ((crc << 8) ^ TABLE[(crc >> 8) ^ byte]) & 0xffff;
  }
  return crc;
}

/** Returns the CRC as the 4 uppercase hex digits that go into tag 63. */
export function crc16ccittHex(input: string): string {
  return crc16ccitt(input).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Appends `6304` + checksum to a payload body. The CRC is computed over
 * everything up to and including the `6304` header, per EMVCo 4.7.4.
 */
export function withChecksum(bodyWithoutCrc: string): string {
  const withHeader = `${bodyWithoutCrc}6304`;
  return withHeader + crc16ccittHex(withHeader);
}

/** True when the trailing tag-63 checksum of a full payload is correct. */
export function verifyChecksum(payload: string): boolean {
  if (payload.length < 8) return false;
  const head = payload.slice(0, -4);
  const tail = payload.slice(-4).toUpperCase();
  if (!head.endsWith("6304")) return false;
  return crc16ccittHex(head) === tail;
}
