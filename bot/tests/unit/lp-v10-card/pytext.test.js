const { esc, unesc, cpLen, truthy, str, BS, BE } = require('../../../shared/services/lp-v10-card/pytext');

describe('pytext: Python string semantics the card port relies on', () => {
  test('esc without quote escapes & < > only (html.escape quote=False)', () => {
    expect(esc('a & <b> "q" \'s\'', false)).toBe('a &amp; &lt;b&gt; "q" \'s\'');
  });
  test('esc with quote also escapes " and \' as Python does (&quot; and &#x27;)', () => {
    expect(esc('"x" \'y\' & <', true)).toBe('&quot;x&quot; &#x27;y&#x27; &amp; &lt;');
  });
  test('unesc decodes named, decimal and hex references', () => {
    expect(unesc('a&amp;b &lt;i&gt; &quot;q&quot; &#39;x&#39; &#x27;y&#x27; &nbsp;')).toBe('a&b <i> "q" \'x\' \'y\'  ');
  });
  test('unesc leaves an unknown reference alone and decodes legacy ones with no semicolon', () => {
    expect(unesc('&nope; &amp')).toBe('&nope; &');
  });
  test('unesc turns an invalid numeric reference into U+FFFD, as Python does', () => {
    expect(unesc('&#0; &#xD800; &#1114112;')).toBe('� � �');
  });
  test('cpLen counts code points like Python len, not UTF-16 units', () => {
    expect(cpLen('😀a')).toBe(2);
    expect('😀a'.length).toBe(3);
  });
  test('truthy follows Python: empty list, dict and string are false', () => {
    expect([null, undefined, 0, '', [], {}, false].map(truthy)).toEqual(Array(7).fill(false));
    expect([1, 'a', [0], { a: 1 }, true].map(truthy)).toEqual(Array(5).fill(true));
  });
  test('str follows Python for strings and ints', () => {
    expect(str('x')).toBe('x');
    expect(str(7)).toBe('7');
  });
  test('BS and BE are Unicode word boundaries (Python \\b), so Urdu letters count as word characters', () => {
    const re = new RegExp(`${BS}جوڑی${BE}`, 'u');
    expect(re.test('بچے جوڑی بنائیں')).toBe(true);
    expect(re.test('جوڑیں')).toBe(false);
    expect(new RegExp(`${BS}pair${BE}`, 'iu').test('a pair.')).toBe(true);
    expect(new RegExp(`${BS}pair${BE}`, 'iu').test('repair')).toBe(false);
  });
});
