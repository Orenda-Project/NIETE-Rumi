const { CSS } = require('../../../shared/services/lp-v10-card/css');
const { css } = require('../../fixtures/lp-v10-card/load');

test('embedded CSS equals card.css byte for byte', () => {
  expect(CSS).toBe(css());
  expect(CSS.endsWith('\n')).toBe(true);
});
