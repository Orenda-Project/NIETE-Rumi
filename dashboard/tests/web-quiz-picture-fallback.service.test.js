/* A picture item whose picture cannot be drawn for one option (dashboard/public/wq/wq.js, itemHtml).
 * The bot drops a pic it cannot draw and the option stays a word (web-quiz-figure drawOptionPics). On a
 * picture grid that word was painted twice — once as a 64 px "emoji" and again as the tile's name —
 * and in Urdu the two overlapped (render matrix, ur-picture-missing-pictogram). A picture item where
 * not every option is a picture plays as an ordinary list of words. */
const WQI = require('../public/wq/wq.js');

const T = { listen: 'Listen', zoom: 'Bigger' };
const PIC = (name) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="${name}"><circle cx="36" cy="36" r="20"/></svg>`, name, alt: name });

describe('picture item with one option that has no picture', () => {
  const q = {
    type: 'picture', text: 'ان میں سے کون سا پھل ہے؟', correct_slot: 'A',
    options: [{ slot: 'A', text: 'سیب', name: 'سیب', pic: PIC('apple') }, { slot: 'B', text: 'کرسی', name: 'کرسی' }, { slot: 'C', text: 'پنسل', name: 'پنسل', pic: PIC('pencil') }],
  };
  it('plays as a list of words, each word once', () => {
    const h = WQI.itemHtml(q, T, 'ur');
    expect(h).not.toContain('wq-pgrid');
    expect(h).not.toContain('wq-emoji');
    expect((h.match(/کرسی/g) || []).length).toBe(1);
    expect((h.match(/class="wq-opt /g) || []).length).toBe(3);
  });
  it('a real emoji grid (every option a picture or an emoji) is unchanged', () => {
    const e = { ...q, options: [{ slot: 'A', text: '🍎' }, { slot: 'B', text: '🪑' }, { slot: 'C', text: '✏️' }] };
    expect(WQI.itemHtml(e, T, 'en')).toContain('wq-pgrid');
    const all = { ...q, options: q.options.map((o) => ({ ...o, pic: PIC(o.name) })) };
    expect(WQI.itemHtml(all, T, 'ur')).toContain('wq-pgrid');
  });
});
