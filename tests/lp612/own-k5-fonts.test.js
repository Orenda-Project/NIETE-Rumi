/**
 * bd-snkn32.4 — the grades 1–5 Make my own page embeds its fonts (the Railway Chromium has none): Lexend always,
 * Noto Nastaliq Urdu for an Urdu book, as base64 data URIs, never a link to a web font.
 */
const fs = require('fs');
const path = require('path');
const { fontCss, FILES } = require('../../bot/shared/services/lp-k5-own-fonts');

test('the font files it names are in the repo', () => {
  for (const f of Object.values(FILES)) expect(fs.existsSync(path.join(__dirname, '../../bot/shared/fonts', f))).toBe(true);
});

test('Urdu embeds Nastaliq; English does not need it; nothing is fetched', () => {
  const ur = fontCss('ur');
  expect(ur).toMatch(/font-family:"Noto Nastaliq Urdu";src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{1000}/);
  expect(ur).toContain('font-family:"Lexend"');
  expect(fontCss('en')).not.toContain('Nastaliq');
  expect(ur + fontCss('en')).not.toMatch(/https?:\/\//);
});
