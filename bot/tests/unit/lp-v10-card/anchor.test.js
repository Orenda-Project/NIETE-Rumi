const { addIds, missing, ORDER, BAR } = require('../../../shared/services/lp-v10-card/anchor');

const SECS = '<div data-atom class="s-i"></div><div data-atom class="s-d"></div><div data-atom class="s-we"></div>'
  + '<div data-atom class="s-a"></div><div data-atom class="s-c"></div><div data-atom class="s-h"></div>';

describe('anchor: give each v9 section a stable id', () => {
  test('tags the six sections in order and names them', () => {
    const h = addIds(SECS);
    expect(ORDER).toEqual(['open', 'explain', 'we', 'you', 'check', 'hw']);
    expect(Object.values(BAR)).toEqual(ORDER);
    for (const s of ORDER) expect(h).toContain(`<div data-atom id="v9-${s}" class=`);
    expect(missing(h)).toEqual([]);
  });
  test('is idempotent', () => {
    const once = addIds(SECS);
    expect(addIds(once)).toBe(once);
  });
  test('only the first block of a section is tagged', () => {
    const h = addIds('<div data-atom class="s-i"></div><div data-atom class="s-i"></div>');
    expect(h.match(/id="v9-open"/g)).toHaveLength(1);
  });
  test('uses the first known class of a multi-class block and ignores unknown ones', () => {
    expect(addIds('<div data-atom class="x s-we y">')).toBe('<div data-atom id="v9-we" class="x s-we y">');
    expect(addIds('<div data-atom class="zzz">')).toBe('<div data-atom class="zzz">');
  });
  test('missing lists the sections with no id, in order', () => {
    expect(missing(addIds(SECS.replace('s-h', 's-x')))).toEqual(['hw']);
    expect(missing('')).toEqual(ORDER);
  });
  // Sandbox 7 Nov: an ICT 6-12 page (the runtime v9) has no s-we bar. Its We Do is a block marked `we` inside
  // the Activity section, so every card that linked "we" was refused: "v9 has no section to land on: we".
  test('an ICT 6-12 page lands "we" on its We Do block', () => {
    const ict = SECS.replace('<div data-atom class="s-we"></div>', '')
      .replace('<div data-atom class="s-a"></div>', '<div data-atom class="bar s-a"></div><div data-atom class="blk exq we sp-2"></div>');
    const h = addIds(ict);
    expect(h).toContain('<div data-atom id="v9-we" class="blk exq we sp-2">');
    expect(missing(h)).toEqual([]);
  });
  test('a GB page keeps "we" on its s-we bar, not a later We Do block', () => {
    const h = addIds(SECS.replace('<div data-atom class="s-a"></div>', '<div data-atom class="s-a"></div><div data-atom class="blk we"></div>'));
    expect(h).toContain('<div data-atom id="v9-we" class="s-we">');
    expect(h.match(/id="v9-we"/g)).toHaveLength(1);
  });
});
