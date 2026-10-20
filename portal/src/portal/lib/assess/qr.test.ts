import { describe, it, expect } from 'vitest';
import { qrMatrix, qrSvgPath } from './qr';

// References come from an independent encoder (byte mode, level M, its own mask
// choice), one row per string as hex, most significant bit first.

const V2_TEXT = 'HELLO coach 123';
const V2 = [
  'fe8f3f8',
  '82a4a08',
  'ba28ae8',
  'baa32e8',
  'ba12ae8',
  '827da08',
  'feaabf8',
  '00f1800',
  'b73da58',
  '50d7128',
  '7a44d80',
  'a5a9f70',
  'f68bed8',
  '70bb7f0',
  '7e34ab0',
  'a892388',
  '1aaaf98',
  '00838c0',
  'fee6ab8',
  '8296888',
  'ba46f98',
  'bae02c8',
  'baa2790',
  '821f0e0',
  'feb1278',
];

const V8_TEXT = 'https://example.org/path?q=' + 'x'.repeat(110) + '&é=ü';
const V8 = [
  'fe6d50ae08bf8',
  '821a9a74a3a08',
  'bad096abb1ae8',
  'baa1e5077d2e8',
  'bacf7ff60c2e8',
  '82a0aa3ce2208',
  'feaaaaaaaabf8',
  '00857a29f3800',
  'be343be358be0',
  '10e896560c670',
  '6732457ca74d8',
  'e485c928e3988',
  'eb81938348920',
  'bd3604c61c270',
  '9e6eb06c3f0d8',
  '85662531f3988',
  '26fd798b58b20',
  '814ff6c20c610',
  '630ce468a74d8',
  '406a296fb1988',
  '9f4adb833ca20',
  'b4a0d6960c7f0',
  '3f85e7f8a2fd8',
  'c8844e29f3888',
  'cad93ea358aa0',
  '88a832360d8f0',
  '4fdb23fca6fd8',
  'e1c80a09e2c08',
  '5331c5b3591a0',
  'a5c27c878d360',
  '9ef74bd5b6e58',
  '44153aeff2c90',
  '52127b31595b0',
  'b0fc51840d510',
  '7a98c6daa6a58',
  '25308869d6888',
  '6fa31d237d1a0',
  '597d35920d370',
  '47a882dce6658',
  '71b5ea69f2c88',
  'e2637fe359fa0',
  '008bd6360c8f0',
  'fe68c6bca6ad8',
  '82f2ce28e2888',
  'baec53e258fa0',
  'bae3036f8c9e8',
  'badb97ad2e340',
  '827564fbf3608',
  'fef4f81d59c38',
];

function hexRows(m: boolean[][]): string[] {
  return m.map((row) => {
    const bits = row.map((d) => (d ? '1' : '0')).join('').padEnd(Math.ceil(row.length / 4) * 4, '0');
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  });
}

describe('qrMatrix', () => {
  it('matches the reference for a version 2 symbol', () => {
    const m = qrMatrix(V2_TEXT);
    expect(m.length).toBe(25);
    expect(hexRows(m)).toEqual(V2);
  });

  it('matches the reference for a version 8 symbol with UTF-8 and version info', () => {
    const m = qrMatrix(V8_TEXT);
    expect(m.length).toBe(49);
    expect(hexRows(m)).toEqual(V8);
  });

  it('picks the smallest version that fits', () => {
    expect(qrMatrix('a'.repeat(14)).length).toBe(21);
    expect(qrMatrix('a'.repeat(15)).length).toBe(25);
    expect(qrMatrix('a'.repeat(666)).length).toBe(97);
  });

  it('throws when the text is too long for version 20', () => {
    expect(() => qrMatrix('a'.repeat(667))).toThrow(/too long/);
  });
});

describe('qrSvgPath', () => {
  it('offsets dark runs by the quiet zone', () => {
    const { size, d } = qrSvgPath(
      [
        [true, true, false],
        [false, false, true],
        [false, false, false],
      ],
      4,
    );
    expect(size).toBe(11);
    expect(d).toBe('M4 4h2v1h-2zM6 5h1v1h-1z');
  });

  it('covers every dark module exactly once', () => {
    const m = qrMatrix(V2_TEXT);
    const { size, d } = qrSvgPath(m, 0);
    expect(size).toBe(25);
    const dark = m.flat().filter(Boolean).length;
    const widths = [...d.matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
    expect(widths).toBe(dark);
  });
});
