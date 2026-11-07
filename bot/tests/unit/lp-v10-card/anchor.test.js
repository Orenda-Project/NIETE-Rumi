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
});
