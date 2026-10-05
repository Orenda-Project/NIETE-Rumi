/* A match question's left tiles can be pictures (dashboard/public/wq/wq.js, item markup).
 * A WhatsApp match question (cat, dog, cow to their sounds) reaches the page as a match item
 * whose left tiles are a letter and a picture: the tile shows the picture beside its letter. */
const WQI = require('../public/wq/wq.js');

const T = { matchHelp: 'Tap a picture, then its partner.', check: 'Check', zoom: 'Bigger' };
const PIC = (name) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="${name}"><circle cx="36" cy="36" r="20"/></svg>`, name, alt: name });

describe('match: picture tiles on the left', () => {
  const q = {
    type: 'match', text: 'Match P, Q and R to the sound each animal makes.',
    left: [{ text: 'P', pic: PIC('cat') }, { text: 'Q', pic: PIC('dog') }, { text: 'R', pic: PIC('cow') }],
    options: [{ slot: 'A', text: 'meow' }, { slot: 'B', text: 'woof' }, { slot: 'C', text: 'moo' }],
  };
  it('each left tile shows its picture and its letter', () => {
    const h = WQI.itemHtml(q, T, 'en');
    const lefts = h.match(/<button class="wq-ml[ "][\s\S]*?<\/button>/g) || [];
    expect(lefts).toHaveLength(3);
    lefts.forEach((b, i) => {
      expect(b).toContain('aria-label="' + ['cat', 'dog', 'cow'][i] + '"');
      expect(b).toContain('>' + ['P', 'Q', 'R'][i] + '<');
    });
  });
  it('a text-only left tile is unchanged', () => {
    const h = WQI.itemHtml({ ...q, left: [{ text: 'cat' }, { text: 'dog' }, { text: 'cow' }] }, T, 'en');
    expect(h).not.toMatch(/<button class="wq-ml"[^>]*>[\s\S]*?<svg/);
  });
});
