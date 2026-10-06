/* Web quiz figures follow the page's brand (dashboard/public/wq/wq.css, figures section).
 *  - The engine paints each figure with the NIETE palette, set as custom properties INLINE on the
 *    figure's own <svg>. A Rumi-themed page would still shade a fraction bar NIETE green. The page
 *    maps the accent and ink slots to the brand tokens with !important (which beats the inline value);
 *    the semantic slots (leaf, warn, cool...) are left alone. (Urdu labels inside a figure take the
 *    page's Urdu face through the Urdu section's own rule.) */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '../public/wq/wq.css'), 'utf8');
// The whole rule whose selector list is exactly `sel` (not a longer selector that ends with it).
const ruleFor = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(^|\\})\\s*' + esc + '\\{[^}]*\\}').exec(CSS);
  return m ? m[0] : '';
};

describe('figures wear the page brand', () => {
  it('the accent, its tint and the structure ink come from the brand tokens, over the inline palette', () => {
    const r = ruleFor('.wq-svg svg');
    expect(r).toMatch(/--amber:var\(--brand,\s*#47BA7D\)\s*!important/i);
    expect(r).toMatch(/--amber-soft:var\(--brand-l,\s*#E4F5EC\)\s*!important/i);
    expect(r).toMatch(/--navy:var\(--brand-ink,\s*#333748\)\s*!important/i);
  });
  it('semantic colours are not brand-coloured', () => {
    expect(ruleFor('.wq-svg svg')).not.toMatch(/--(leaf|warn|cool|plum|clay|teal):/);
  });
});
