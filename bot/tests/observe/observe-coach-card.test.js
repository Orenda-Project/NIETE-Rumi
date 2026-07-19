/**
 * FEAT-053 bd-44 — coach feedback as a rendered CARD (hero design),
 * anchored on a coaching VALUE (Sabeena's feedback: organise the artefact
 * around the value the officer's coaching embodied).
 *
 * Rules under test:
 *  - value is OPTIONAL (D36 — an LLM field describing reality may be null);
 *    invalid values are stripped, null gets the neutral header.
 *  - the card HTML carries value → praise → wins (with quotes) → one try.
 *  - a HARMFUL debrief never gets a celebration card (harm gate survives).
 *  - no numeric score anywhere on the card.
 */

const {
  COACH_VALUES,
  normalizeCoachValue,
  buildCoachCardHtml,
  shouldRenderCard,
} = require('../../shared/services/observe/observe-coach-card');
const { validateCoachFeedback, buildCoachFeedbackPrompt } = require('../../shared/services/observe/observe-coach-feedback');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

const fb = (over = {}) => ({
  praise_line: 'Ulianza na sifa ya kweli.',
  wins: [
    { behaviour: 'Ulianza na sifa yenye ushahidi', evidence: 'Nilipenda ulivyotumia vijiti' },
    { behaviour: 'Ulimwachia mwalimu ahadi yake', evidence: 'Nitajaribu kesho asubuhi' },
  ],
  try: { move: 'Shikilia ukimya', evidence: 'Ulijibu mwenyewe haraka', instead: 'Hesabu sekunde tatu kimya' },
  concern: null,
  rubric: {
    opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: false,
    one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true,
    righting_reflex_held: false, disparaged_teacher: false,
  },
  value: 'imani',
  ...over,
});

describe('COACH_VALUES + normalizeCoachValue', () => {
  test('the value set is fixed and bilingual', () => {
    for (const v of Object.values(COACH_VALUES)) {
      expect(v.sw).toBeTruthy();
      expect(v.en).toBeTruthy();
    }
  });
  test('valid value passes through; junk and null normalize to null (D36 — never invent)', () => {
    expect(normalizeCoachValue('imani')).toBe('imani');
    expect(normalizeCoachValue('IMANI ')).toBe('imani');
    expect(normalizeCoachValue('excellence')).toBeNull();
    expect(normalizeCoachValue(null)).toBeNull();
    expect(normalizeCoachValue(undefined)).toBeNull();
  });
});

describe('buildCoachCardHtml', () => {
  test('value anchors the header; praise, wins with quotes, and the ONE try are all present', () => {
    const html = buildCoachCardHtml(fb(), { lang: 'sw' });
    expect(html).toContain(COACH_VALUES.imani.sw);            // value as the organising header
    expect(html).toContain('Ulianza na sifa ya kweli.');      // praise line
    expect(html).toContain('Nilipenda ulivyotumia vijiti');   // win evidence quoted
    expect(html).toContain('Shikilia ukimya');                // the one try
    expect(html).toContain('Hesabu sekunde tatu kimya');
  });

  test('null value → neutral header, never an invented value', () => {
    const html = buildCoachCardHtml(fb({ value: null }), { lang: 'sw' });
    for (const v of Object.values(COACH_VALUES)) expect(html).not.toContain(`>${v.sw}<`);
    expect(html).toContain(S.coach_card_title);
  });

  test('no numeric score ever appears in the card CONTENT (CSS + embedded assets excluded)', () => {
    const html = buildCoachCardHtml(fb(), { lang: 'sw' });
    // bd-63: the card now embeds the Rumi mark + fonts as base64 data URIs —
    // those blobs legitimately contain digit runs. The score rule is about
    // what the OFFICER SEES, so strip CSS and data URIs before scanning.
    const content = html
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/data:[^"']*/g, '');
    expect(content).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(content).not.toMatch(/\d+\s*%/);
  });

  test('HTML-escapes model output (a quote containing <script> cannot execute in the renderer)', () => {
    const html = buildCoachCardHtml(
      fb({ praise_line: 'x <script>alert(1)</script>' }), { lang: 'sw' });
    expect(html).not.toContain('<script>alert');
  });
});

describe('harm gate survives the card redesign', () => {
  test('shouldRenderCard is FALSE for a harmful debrief — no celebration card for cruelty', () => {
    const harmful = fb({
      praise_line: null, wins: [],
      concern: { what_happened: 'Ulimdhalilisha mwalimu', why_it_matters: 'Inavunja imani', instead: 'Anza na heshima' },
      rubric: { ...fb().rubric, disparaged_teacher: true },
    });
    expect(shouldRenderCard(harmful)).toBe(false);
    expect(shouldRenderCard(fb())).toBe(true);
  });
});

describe('feedback contract additions', () => {
  test('the prompt asks for the value from the FIXED set, null allowed', () => {
    const p = buildCoachFeedbackPrompt('transcript', { foName: 'Elisha' });
    expect(p).toContain('"value"');
    for (const key of Object.keys(COACH_VALUES)) expect(p).toContain(key);
    expect(p).toMatch(/null/);
  });

  test('validateCoachFeedback strips an invalid value instead of failing the whole feedback', () => {
    const f = fb({ value: 'made-up-value' });
    validateCoachFeedback(f);
    expect(f.value).toBeNull();
  });

  test('validateCoachFeedback keeps a valid value', () => {
    const f = fb();
    validateCoachFeedback(f);
    expect(f.value).toBe('imani');
  });
});

// bd-64 (operator directive): NotoNastaliqUrdu on EVERY Urdu artifact — the
// card must embed and use it, exactly like the teacher hero report does.
describe('bd-64 — Urdu renders in NotoNastaliqUrdu', () => {
  const fb = () => ({
    praise_line: 'آپ نے سچی تعریف سے آغاز کیا۔',
    wins: [{ behaviour: 'ثبوت کے ساتھ تعریف', evidence: 'مجھے یہ لمحہ اچھا لگا' }],
    try: { move: 'خاموشی برقرار رکھیں', evidence: 'x', instead: 'y' },
    rubric: { disparaged_teacher: false, righting_reflex_held: true },
    value: 'ukuaji',
  });

  test('ur card embeds the Nastaliq font-face and puts it first in the stack', () => {
    const html = buildCoachCardHtml(fb(), { lang: 'ur' });
    expect(html).toContain("font-family:'NastaliqUrdu';font-weight:400");
    expect(html).toContain("font-family:'NastaliqUrdu';font-weight:700");
    expect(html).toMatch(/font-family:'NastaliqUrdu','Lexend'/);
    expect(html).toContain('dir="rtl"');
  });

  test('sw card does NOT carry the Nastaliq-first stack (Lexend stays primary)', () => {
    const html = buildCoachCardHtml(fb(), { lang: 'sw' });
    expect(html).not.toMatch(/font-family:'NastaliqUrdu','Lexend'/);
  });
});
