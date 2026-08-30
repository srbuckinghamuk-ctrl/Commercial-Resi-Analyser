/**
 * A pure, synchronous, dependency-free SHA-256 (FIPS 180-4) over a UTF-8
 * string, plus the canonical-JSON serialiser that feeds it (R17, plan Task 8;
 * spec §27's `benchmarkContentHash`).
 *
 * Why not Web Crypto: `crypto.subtle.digest` is asynchronous and absent from
 * insecure (http) origins and from parts of the test environment, and the
 * content hash is computed inside the synchronous engine. Tested against the
 * NIST vectors in `sha256.test.ts`; the Python side is `hashlib.sha256`.
 */

// The first 32 bits of the fractional parts of the cube roots of the first 64
// primes (FIPS 180-4 §4.2.2).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of the UTF-8 encoding of `text`, as 64 lower-case hex characters. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;

  // Pad: 0x80, zeros to 56 mod 64, then the 64-bit big-endian bit length.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Messages here are far below 2^32 bits, but write both words regardless.
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  // Initial hash: the first 32 bits of the fractional parts of the square
  // roots of the first 8 primes (FIPS 180-4 §5.3.3).
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += h[i].toString(16).padStart(8, '0');
  return hex;
}

// --- canonical JSON ---------------------------------------------------------

export interface CanonicalJsonOptions {
  /**
   * How an integral number is rendered. JavaScript has one number type, so
   * `1` and `1.0` are the same value and `JSON.stringify` prints both as `1`;
   * Python keeps `int` and `float` apart and `json.dumps` prints a float
   * `1.0` as `1.0`. That is the one asymmetry between this serialiser and
   * `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
   * for the value types the engine uses.
   *
   * - `'bare'` (default): as `JSON.stringify` — `1`. Matches Python when the
   *   Python value is an `int`.
   * - `'dotZero'`: an integral finite number whose plain rendering carries no
   *   `.` or exponent is printed as `1.0`. Matches Python when the Python value
   *   is a `float`. It cannot tell a Python `int` field from a `float` field,
   *   so a mixed document matches under neither option: a hash-parity test must
   *   normalise on the Python side (`int(x)` for every integral float, or the
   *   reverse), and `sha256.test.ts` pins the asymmetry so that is not
   *   forgotten.
   *
   * Other, rarer divergences are left as they are and recorded here: Python
   * prints `1e-7` as `1e-07` (JS: `1e-7`) — both print `1e21` as `1e+21`;
   * Python prints `-0.0` as `-0.0` (JS: `0`); Python emits the invalid tokens
   * `NaN`/`Infinity` where JS emits `null`. None of these occur in an engine
   * document, whose numbers are pence integers, small percentages and factors.
   */
  integralFloats?: 'bare' | 'dotZero';
}

function canonicalNumber(n: number, style: 'bare' | 'dotZero'): string {
  const plain = JSON.stringify(n);
  if (style === 'dotZero' && Number.isInteger(n) && !/[.eE]/.test(plain)) return `${plain}.0`;
  return plain;
}

/**
 * Deterministic JSON: object keys sorted recursively, `,` and `:` separators
 * with no whitespace, non-ASCII kept as-is (not `\u`-escaped), numbers and
 * strings rendered as `JSON.stringify` renders them. Matches Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
 * for the engine's value types, subject to the integral-float asymmetry
 * documented on `CanonicalJsonOptions`.
 *
 * As `JSON.stringify`: `undefined`, functions and symbols are dropped from
 * objects and become `null` inside arrays; a value with a `toJSON` method
 * (a `Date`) is replaced by its result first. Keys sort by UTF-16 code unit,
 * which equals Python's code-point order for every key without astral
 * characters (the engine's keys are snake_case ASCII).
 */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  const style = options.integralFloats ?? 'bare';
  const render = (v: unknown): string | undefined => {
    if (v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      return render((v as { toJSON: () => unknown }).toJSON());
    }
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return canonicalNumber(v, style);
      case 'string': return JSON.stringify(v);
      case 'undefined': case 'function': case 'symbol': return undefined;
      case 'bigint': throw new TypeError('canonicalJson: bigint is not JSON-serialisable');
      default: break;
    }
    if (Array.isArray(v)) return `[${v.map((item) => render(item) ?? 'null').join(',')}]`;
    const record = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const rendered = render(record[key]);
      if (rendered !== undefined) parts.push(`${JSON.stringify(key)}:${rendered}`);
    }
    return `{${parts.join(',')}}`;
  };
  return render(value) ?? 'null';
}

/** `sha256Hex(canonicalJson(value))` — the content hash of a document. */
export function canonicalHash(value: unknown, options: CanonicalJsonOptions = {}): string {
  return sha256Hex(canonicalJson(value, options));
}
