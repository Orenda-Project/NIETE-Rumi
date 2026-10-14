'use strict';
/**
 * v10 coaching test (bd-v0toag.55): the report page's shell — escaping, direction, private page,
 * the template's step and bar colours, dark mode.
 */
const { esc, shell } = require('../../dashboard/services/coaching-report-style');

test('esc covers the five HTML characters and empty values', () => {
  expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  expect(esc(null)).toBe('');
  expect(esc(undefined)).toBe('');
  expect(esc(0)).toBe('0');
});

test('shell: English left to right, Urdu right to left, anything else English', () => {
  expect(shell('en', 't', '')).toContain('<html lang="en" dir="ltr">');
  expect(shell('ur', 't', '')).toContain('<html lang="ur" dir="rtl">');
  expect(shell('xx', 't', '')).toContain('<html lang="en" dir="ltr">');
});

test('shell: escaped title, body as given, not indexed, phone width', () => {
  const html = shell('en', 'A <b> title', '<p>body</p>');
  expect(html).toContain('<title>A &lt;b&gt; title</title>');
  expect(html).toContain('<p>body</p>');
  expect(html).toContain('name="robots" content="noindex"');
  expect(html).toContain('width=device-width');
});

test('shell: the template\'s five step colours, three bar colours and a dark mode', () => {
  const html = shell('en', 't', '');
  for (const c of ['--s1:#ef8a12', '--s2:#9b55e6', '--s3:#3d5bd6', '--s4:#2f9a46', '--s5:#d63a6a', '--green:#2f8a55', '--amber:#d99a1e', '--red:#c2552f']) {
    expect(html).toContain(c);
  }
  expect(html).toContain('prefers-color-scheme: dark');
});
