/**
 * "درست جوڑ ملائیں" is a real match question (bd-5jmnfj.4.23). v16 G1 GK Q4 printed five
 * stems with nothing to match; v17 G2 GK Q4 printed them as multiple choice. A match slot
 * now prints two columns: the stems, numbered, and their answers in another order, for
 * the child to join with a line. The key pairs each number with its answer.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const gk = require('./fixtures/early/g1-general_knowledge-exam.json');

const SLOT = 'g1.general_knowledge.A.Q4';
const PAIRS = [['اونٹ', 'صحرا'], ['پرندہ', 'گھونسلہ'], ['مالی', 'پودے'], ['مچھلی', 'پانی'], ['ناک', 'سونگھنا']];

function matchPaper() {
  const exam = JSON.parse(JSON.stringify(gk));
  exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
    if (sl.slot !== SLOT) return;
    sl.shape = 'match';
    delete sl.option_labels;
  }));
  const type = Object.keys(exam.unseen.objective).find((k) => exam.unseen.objective[k].some((q) => q.slot === SLOT));
  exam.unseen.objective[type] = exam.unseen.objective[type].map((q, i) => {
    const { options, ...rest } = q;
    return { ...rest, question: PAIRS[i][0], answer: PAIRS[i][1] };
  });
  return exam;
}

const slotHtml = (html) => html.split('<div class="slot').find((s) => s.includes(`data-slot="${SLOT}"`));

describe('the pattern', () => {
  test.each([1, 2])('G%i GK Q4 is a match slot, objective, asking for no options', (g) => {
    const slots = Patterns.get(`fde_g${g}_2026`).subjects.general_knowledge.sections.flatMap((s) => s.slots);
    const q4 = slots.find((s) => s.slot === `g${g}.general_knowledge.A.Q4`);
    expect(q4.shape).toBe('match');
    expect(q4.category).toBe('objective');
    expect(q4.option_labels).toBeUndefined();
    expect(q4.prompt_rule).toMatch(/no options/i);
    expect(q4.prompt_rule).toMatch(/five different answers/i);
  });
});

describe('the printed question', () => {
  const html = slotHtml(R.renderPaper({ examJson: matchPaper(), grade: 1, subject: 'general_knowledge' }));

  test('prints a two-column table and no options', () => {
    expect(html).toContain('match-table');
    expect(html).not.toContain('class="opts');
    expect((html.match(/<tr/g) || []).length).toBe(PAIRS.length);
  });

  test('numbers the stems in order on the right-hand column of an Urdu paper', () => {
    const stems = [...html.matchAll(/class="m-a"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    PAIRS.forEach(([stem], i) => expect(stems[i]).toContain(stem));
  });

  test('never prints an answer beside its own stem', () => {
    const answers = [...html.matchAll(/class="m-b"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    expect(answers).toHaveLength(PAIRS.length);
    PAIRS.forEach(([, answer], i) => expect(answers[i]).not.toContain(answer));
    PAIRS.forEach(([, answer]) => expect(answers.some((a) => a.includes(answer))).toBe(true));
  });
});

describe('the marking scheme', () => {
  test('a match item is objective: no scheme is asked of it', () => {
    const exam = matchPaper();
    const out = normaliseScheme(exam);
    expect(out.shortfall.filter((f) => f.slot === SLOT)).toEqual([]);
  });

  test('the key prints one strip pairing each number with its answer', () => {
    const html = R.renderMarkingScheme({ examJson: matchPaper(), grade: 1, subject: 'general_knowledge', allowShort: true });
    const strip = html.split('<div class="strip"').find((s) => s.startsWith(` data-row="${SLOT}"`));
    expect(strip).toBeDefined();
    PAIRS.forEach(([, answer]) => expect(strip).toContain(answer));
  });
});
