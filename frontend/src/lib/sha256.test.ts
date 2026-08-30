import { describe, it, expect } from 'vitest';
import { canonicalHash, canonicalJson, sha256Hex } from './sha256';

describe('sha256Hex', () => {
  // FIPS 180-4 / NIST CAVP vectors.
  it('empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('two-block message', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('one million "a"', () => {
    expect(sha256Hex('a'.repeat(1_000_000)))
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('hashes the UTF-8 bytes of a non-ASCII string (pinned from hashlib)', () => {
    // python -c "import hashlib; print(hashlib.sha256('m² £'.encode()).hexdigest())"
    expect(sha256Hex('m² £')).toBe('435df7a742436a3e8cb0fbf0b3a410cf975a151166dc03f3e133e12b250baa02');
  });

  it('pads a message that fills the last block exactly (55, 56, 64 bytes)', () => {
    // Boundary lengths around the 0x80 + 8-byte length trailer; compared
    // against hashlib. 55 bytes fits one block, 56 and 64 spill into a second.
    expect(sha256Hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(sha256Hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively with no whitespace and keeps non-ASCII as-is', () => {
    // Python: json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    const doc = { b: 1, a: [1, 2, 'm² £'], c: { y: null, x: true, z: -0.5 } };
    expect(canonicalJson(doc)).toBe('{"a":[1,2,"m² £"],"b":1,"c":{"x":true,"y":null,"z":-0.5}}');
  });

  it('canonicalHash equals hashlib over Python\'s canonical dump of the same document', () => {
    // python: hashlib.sha256(json.dumps(doc, sort_keys=True, separators=(",", ":"),
    //   ensure_ascii=False).encode()).hexdigest()   -- doc as above, all ints
    const doc = { b: 1, a: [1, 2, 'm² £'], c: { y: null, x: true, z: -0.5 } };
    expect(canonicalHash(doc)).toBe('5534cc2af9959c008081a4c0c3f9e3b895d0499134c6bcaa92d453fd4dcec9c0');
  });

  it('drops undefined object members and nulls them inside arrays, as JSON.stringify does', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('escapes strings as JSON.stringify does (which is Python\'s ensure_ascii=False set)', () => {
    expect(canonicalJson('a"b\\c\n\t')).toBe('"a\\"b\\\\c\\n\\t\\u0001"');
  });

  it('pins the integral-float asymmetry against Python', () => {
    // The Python value {"z": {"b": [1, 2.0, None, True, "m² £"], "a": 0.5}, "y": -3}
    // — note the float 2.0 next to the int 1 — dumps to:
    const python = '{"y":-3,"z":{"a":0.5,"b":[1,2.0,null,true,"m² £"]}}';
    const doc = { z: { b: [1, 2.0, null, true, 'm² £'], a: 0.5 }, y: -3 };

    // JS cannot see the difference between 1 and 2.0, so the default
    // rendering differs from Python at exactly that element...
    const bare = canonicalJson(doc);
    expect(bare).toBe('{"y":-3,"z":{"a":0.5,"b":[1,2,null,true,"m² £"]}}');
    expect(bare).not.toBe(python);

    // ...and the 'dotZero' option turns EVERY integral number into a float,
    // which matches Python only when the Python side is all-float.
    const dotZero = canonicalJson(doc, { integralFloats: 'dotZero' });
    expect(dotZero).toBe('{"y":-3.0,"z":{"a":0.5,"b":[1.0,2.0,null,true,"m² £"]}}');
    expect(dotZero).not.toBe(python);

    // So a hash-parity test over an engine document must normalise floats on
    // one side (Python: int(x) for every integral float; or TS: 'dotZero' with
    // the Python side cast to float) before comparing hashes.
    expect(canonicalHash(doc)).not.toBe(sha256Hex(python));
    expect(sha256Hex(bare)).toBe(canonicalHash(doc));
  });

  it('dotZero leaves exponent forms alone', () => {
    // JSON.stringify(1e21) is '1e+21' — the same as Python's json.dumps(1e21).
    expect(canonicalJson(1e21, { integralFloats: 'dotZero' })).toBe('1e+21');
    expect(canonicalJson(1.5, { integralFloats: 'dotZero' })).toBe('1.5');
    expect(canonicalJson(0, { integralFloats: 'dotZero' })).toBe('0.0');
  });
});
