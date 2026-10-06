/**
 * Web quiz page, Urdu: the big mascot's speech bubble (landing, results, "time to rest") is narrow,
 * about 170 px on a 360 px phone, so its Urdu lines wrap and Nastaliq's tall letters on one line
 * reach into the line above. Measured with every line that can show there: the results line
 * «شاباش! پورا کوئز مکمل۔» overlaps by 2.5 px at line-height 1.95 and is clear from 2.2; every
 * other line stays clear at 2.2, at 360 and 412.
 */
const { rule } = require('./wq-page-harness');

test('the big mascot\'s Urdu bubble has the taller line height (2.2)', () => {
  expect(rule('html[lang=ur] .wq-jug.wq-big .wq-say')).toMatch(/line-height:2\.2\b/);
});

test('the small bubbles keep theirs (1.95)', () => {
  expect(rule('html[lang=ur] .wq-say')).toMatch(/line-height:1\.95\b/);
});
