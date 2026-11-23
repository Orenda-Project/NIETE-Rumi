'use strict';
/**
 * bd-o15qnr.46 (queue #241, the operator 23 Nov ~20:25 on the 6-12 Checklist: "weird UI. Should be 2 lines, or combined
 * together with Heading Classroom practice then its questions then next section etc.") — the portal draws the checklist
 * as one heading per category, then that category's questions, numbered, each on its own line. The bot says, on each
 * checklist item (additive; `short` and `text` unchanged, so an older portal keeps today's look):
 *
 *   group   the item's category, in the observer's language ("Classroom environment" / "کلاس روم کا ماحول")
 *   n       the item's number on the checklist, 1..12 (the number the Flow's "Checklist 3" errors use)
 */
const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');

const RUBRIC = 'fico_s_v1_2';
const checklistItems = (lang) => {
  const sec = FF.portalSections({}, lang, { rubric: RUBRIC }).find((s) => s.kind === 'checklist');
  return sec.parts.filter((p) => p.type === 'field' && p.role === 'item');
};

describe('FICO-S checklist items carry their category and number (q#241)', () => {
  test('English: every item has its category and its number, 1..12, in the rubric order', () => {
    const items = checklistItems('en');
    expect(items).toHaveLength(FicoS.RUBRIC.checklist.length);
    items.forEach((f, i) => {
      expect(f.n).toBe(i + 1);
      expect(f.group).toBe(FicoS.RUBRIC.checklist[i].group);
    });
    expect(items[0].group).toBe('Classroom environment');
  });

  test('Urdu: the category in Urdu (the rubric\'s own Urdu names), the number still 1..12', () => {
    const items = checklistItems('ur');
    expect(items[0].group).toBe('کلاس روم کا ماحول');
    items.forEach((f, i) => {
      expect(f.n).toBe(i + 1);
      expect(f.group).toMatch(/[؀-ۿ]/);
    });
  });

  test('a category\'s items sit together, so one heading per category is enough (no category comes back later)', () => {
    const runs = [];
    for (const f of checklistItems('en')) if (runs[runs.length - 1] !== f.group) runs.push(f.group);
    expect(new Set(runs).size).toBe(runs.length);
    expect(runs.length).toBeGreaterThan(1);
  });

  test('additive: `short`, `text`, `kind` and the Yes/No options are as before', () => {
    const items = checklistItems('en');
    expect(items[0].short).toBe('1. Classroom environment');
    expect(items[0].kind).toBe('yes_no');
    expect(items[0].text).toBe(FicoS.checklistText(items[0].name, 'en'));
    expect(items[0].options.map((o) => o.id)).toEqual(['yes', 'no']);
  });

  test('no other section gets a group', () => {
    const others = FF.portalSections({}, 'en', { rubric: RUBRIC }).filter((s) => s.kind !== 'checklist');
    for (const s of others) for (const p of s.parts) expect(p.group).toBeUndefined();
  });
});
