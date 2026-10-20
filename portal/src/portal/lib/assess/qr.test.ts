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

// A signed other-phone link is ~300 bytes: version 14, with 2 block groups and version info.
const V14_TEXT = 'https://example.org/sa/play.html?s=0b6f3c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f&embed=0&t=' +
  Array.from({ length: 258 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789-_'[(i * 7) % 38]).join('');
const V14 = [
  'fe60ae970da22b46bf8',
  '8230e0297ece6d8a208',
  'ba9b9635f3fd49742e8',
  'bae50f7d0855f8032e8',
  'baecd5fedcefd265ae8',
  '82841a8c2a98b036208',
  'feaaaaaaaaaaaaaabf8',
  '00b7ab88f0a88d96000',
  'be12ccff5b7fd84c3e0',
  'fc0d592e05280bc9c60',
  '763269b977d6fcac3f8',
  'a9c6932ac1988f51958',
  '5fc827157c5738eef38',
  '60e573ff446a39d1af0',
  'fb17b1353a51c6a5788',
  '046e06cad1bc0992c00',
  '6b9e4f6f0c64dee66b8',
  'ecedfbea49a83a59680',
  '1a05a13e14f6cd2c2d8',
  '8802d55a2b4203b6118',
  'ab066e61b0a7fa00b68',
  '9974be3a85e20bc3f50',
  '4670499db69c7407fa8',
  'e072d76f95ac897d818',
  'efd1c8fb0c5fbe02fe0',
  'f8e18d8a00388941880',
  'cada23adfe4ade37ae8',
  '8885fd8984b8afd3888',
  '3fc06ffc185fd826fa8',
  '994fd416dce72861490',
  '73cac2f42d88648ed08',
  'd0851698f4ab5170680',
  '3e0c28ff5f731420d78',
  '08a1d1ca04690850a78',
  'e7dc7b54eb4e4d278d8',
  'a17854bbe5e4bbd6298',
  '023214a63c3cf2c3568',
  '3c64695708ef3943d40',
  '723124b0a6787c9ebf8',
  '497ce7ff945d0d396c0',
  '4f0727a908181402d28',
  'd8f860039d6da0d9730',
  '77b6f45cfa428c25858',
  '696e4b1ea28423f6790',
  'ff9478ff3c3ff0c7fa8',
  'f8ec528e1078b0ea880',
  '0adc10a8bf0ad7b4af8',
  '68d97688e2b8cfd9898',
  '7fead0f9091fb26cfe0',
  '246af31a8566a858150',
  'ff4c483c7a5d5417a58',
  '14855905a7c0e7f0b10',
  'de9e91f87b073a0d7b0',
  '35e1a9753e42a160c60',
  'c300e3f3d1bf7cbd5d8',
  '0de931f95c224972718',
  'c2f831622968b423eb8',
  '2525b55f5c60314a950',
  '9a5e60c02b5d7f3fab8',
  '2dd578e2b4f22598240',
  '9a2a2aa11b3f18c57a8',
  '803d7093147f80ead10',
  'd7018ab5739454afdc8',
  '18e1e7adc787ebf3658',
  '8af7fffa1e1fd084fb0',
  '00949b8edd688af08c0',
  'fe2a7bad3a4ae796a98',
  '82ccc58e9688a999880',
  'baf4a8f95b2fbeefff8',
  'badd1b07143b086baa8',
  'baa0e24066433c2c528',
  '82200a43d1c567f3908',
  'fed3a7f76c5af2ae2b8',
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

  it('matches the reference for a version 14 symbol (the size of a signed link)', () => {
    expect(new TextEncoder().encode(V14_TEXT).length).toBe(340);
    const m = qrMatrix(V14_TEXT);
    expect(m.length).toBe(73);
    expect(hexRows(m)).toEqual(V14);
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
