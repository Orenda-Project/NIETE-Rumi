/**
 * AG 1.2 item 6 (bd-q3rfn) — teachers were never told they could change marks,
 * and the Edit control was the smallest thing on the screen.
 *
 * Editing marks and wording in the review Flow went live on 6 Sep. By 30 Sep
 * only 34 of 3,839 NIETE papers had a single mark changed. Two causes, both
 * pinned here:
 *
 *   1. The offer sent after the paper said "Want a shorter paper? … untick any
 *      questions" — it only ever advertised removal.
 *   2. On PICK / PICK_MORE the big Footer was "Done" and Edit was a small
 *      EmbeddedLink under the list. In 14 days PICK arrived 834 times carrying
 *      only `_action` and 108 times carrying `question_id`.
 *
 * So: the offer names marks, wording and removal in the teacher's language;
 * Edit is the Footer; finishing is the secondary link; and the endpoint logs
 * WHICH action arrived so the funnel can be measured instead of inferred.
 */
const fs = require('fs');
const path = require('path');

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockRerender = jest.fn();
const mockListQuestions = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(true),
  // The old KEEP/PICK path: versioned editing explicitly OFF.
  isAssessmentVersionsEnabled: jest.fn().mockResolvedValue(false),
  ASSESSMENT_GENERATOR_KEY: 'assessment_generator_enabled',
  ASSESSMENT_EDITING_KEY: 'assessment_editing_enabled',
}));
jest.mock('../../bot/shared/services/assessment/assessment-revision.service', () => ({
  rerender: (...a) => mockRerender(...a),
  listQuestions: (...a) => mockListQuestions(...a),
  saveEdit: jest.fn(),
}));

const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const { handleAssessmentGenDataExchange: exchange } = require('../../bot/shared/routes/assessment-gen-endpoint');

// The KEEP/PICK review Flow is the asset a deployment serves while
// assessment_versions_enabled is OFF. Versioned editing replaced it in
// docs/flows/assessment-review-flow.json (LIST/DONE, v8); the old JSON is kept
// as the rollback asset and still pinned here until the old path is deleted.
const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/rollback/assessment-review-flow.prod-v7-2026-09-30.json'), 'utf8'));
const ORCH_SRC = fs.readFileSync(path.join(__dirname,
  '../../bot/shared/services/assessment/assessment-orchestrator.service.js'), 'utf8');

const cp = (s) => [...s].length;
const TOKEN = 'user-1:assessment-review:paper-1';
const ITEMS = [
  { id: 'a.b.MCQs.0', number: 1, marks: 1, type: 'MCQs', text: 'Which is a living thing?',
    selected: true, shape: 'options',
    question: { question: 'Which is a living thing?', options: ['Rock', 'Plant'], marks: 1 } },
  { id: 'a.b.Fill.0', number: 2, marks: 1, type: 'Fill', text: 'Plants make food using ____.',
    selected: true, shape: 'standard',
    question: { question: 'Plants make food using ____.', marks: 1 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue({
    userId: 'user-1', paperId: 'paper-1', page: 0, selected: ITEMS.map((q) => q.id),
  });
  mockRedis.set.mockResolvedValue(true);
  mockListQuestions.mockResolvedValue({ items: ITEMS, paper: { id: 'paper-1' } });
});

describe('the review offer says what it really does', () => {
  const KEYS = { header: 'assessmentReviewOfferHeader', body: 'assessmentReviewOfferBody',
    button: 'assessmentReviewOfferButton' };

  test('every part exists in both offered languages', () => {
    for (const key of Object.values(KEYS)) {
      expect(Object.keys(UX_STRINGS[key]).sort()).toEqual(['en', 'ur']);
    }
  });

  test('the English names marks, wording and removal', () => {
    const body = UX_STRINGS[KEYS.body].en.toLowerCase();
    expect(body).toMatch(/marks/);
    expect(body).toMatch(/wording/);
    expect(body).toMatch(/remove/);
    expect(UX_STRINGS[KEYS.header].en.toLowerCase()).toMatch(/marks/);
  });

  test('the Urdu names marks (نمبر), wording (الفاظ) and removal (ہٹا)', () => {
    const body = UX_STRINGS[KEYS.body].ur;
    expect(body).toContain('نمبر');
    expect(body).toContain('الفاظ');
    expect(body).toContain('ہٹا');
    expect(UX_STRINGS[KEYS.header].ur).toContain('نمبر');
  });

  test('it no longer advertises only a shorter paper', () => {
    expect(UX_STRINGS[KEYS.body].en).not.toMatch(/shorter paper/i);
  });

  test('fits the WhatsApp caps in code points, with headroom on header and button', () => {
    for (const lang of ['en', 'ur']) {
      expect(cp(UX_STRINGS[KEYS.header][lang])).toBeLessThanOrEqual(55);
      expect(cp(UX_STRINGS[KEYS.body][lang])).toBeLessThanOrEqual(1024);
      expect(cp(UX_STRINGS[KEYS.button][lang])).toBeLessThanOrEqual(20);
    }
  });

  test('the orchestrator reads the catalogue for her language, not inline literals', () => {
    expect(ORCH_SRC).not.toContain('Change this paper');
    expect(ORCH_SRC).not.toContain('Choose questions');
    for (const key of Object.values(KEYS)) {
      expect(ORCH_SRC).toMatch(new RegExp(`resolveUx\\('${key}',\\s*\\{\\s*user`));
    }
  });
});

describe('PICK and PICK_MORE — Edit is the main button', () => {
  const walk = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((n) => walk(n, out));
    else if (node && typeof node === 'object') {
      if (node.type) out.push(node);
      Object.values(node).forEach((v) => walk(v, out));
    }
    return out;
  };

  for (const id of ['PICK', 'PICK_MORE']) {
    const parts = walk(FLOW.screens.find((s) => s.id === id).layout);

    test(`${id}: the Footer opens the selected question`, () => {
      const footer = parts.find((c) => c.type === 'Footer');
      const act = footer['on-click-action'];
      expect(act.name).toBe('data_exchange');
      expect(act.payload).toEqual({ _action: 'open', question_id: '${form.pick}' });
      expect(footer.label).toMatch(/Edit/);
      expect(cp(footer.label)).toBeLessThanOrEqual(35);
    });

    test(`${id}: finishing is a secondary link that sends pick_done`, () => {
      const links = parts.filter((c) => c.type === 'EmbeddedLink');
      const finish = links.find((l) => l['on-click-action'].payload._action === 'pick_done');
      expect(finish).toBeTruthy();
      expect(cp(finish.text)).toBeLessThanOrEqual(25);
      // No second way to open a question: one Edit, and it is the Footer.
      expect(links.filter((l) => l['on-click-action'].payload._action === 'open')).toEqual([]);
    });

    test(`${id}: the heading carries English alongside the Urdu`, () => {
      const heading = parts.find((c) => c.type === 'TextHeading').text;
      expect(heading).toMatch(/[؀-ۿ]/);
      expect(heading).toMatch(/[A-Za-z]{3,}/);
      expect(cp(heading)).toBeLessThanOrEqual(80);
    });
  }
});

describe('the endpoint serves both actions and logs which one arrived', () => {
  const actionLogs = () => mockLog.mock.calls.filter(([msg]) => msg === '[assessment-flow] review action');

  for (const screenId of ['PICK', 'PICK_MORE']) {
    test(`${screenId}: Edit with a question opens its edit screen`, async () => {
      const res = await exchange('user-1', screenId, { _action: 'open', question_id: 'a.b.Fill.0' }, TOKEN);
      expect(res.screen).toBe('EDIT_STANDARD');
    });

    test(`${screenId}: Edit with nothing ticked stays put and says so`, async () => {
      const res = await exchange('user-1', screenId, { _action: 'open', question_id: '' }, TOKEN);
      expect(res.screen).toBe(screenId);
      expect(res.data.error).toBe('Tap a question first, then Edit.');
      expect(res.data.has_error).toBe(true);
    });

    test(`${screenId}: Finish goes to PICK_DONE`, async () => {
      const res = await exchange('user-1', screenId, { _action: 'pick_done' }, TOKEN);
      expect(res.screen).toBe('PICK_DONE');
    });

    test(`${screenId}: the action value is logged, not just the keys`, async () => {
      await exchange('user-1', screenId, { _action: 'open', question_id: 'a.b.Fill.0' }, TOKEN);
      await exchange('user-1', screenId, { _action: 'pick_done' }, TOKEN);
      const logged = actionLogs().map(([, meta]) => meta);
      expect(logged).toEqual([
        expect.objectContaining({ screen: screenId, action: 'open', hasQuestionId: true, userId: 'user-1' }),
        expect.objectContaining({ screen: screenId, action: 'pick_done', hasQuestionId: false }),
      ]);
    });
  }

  test('KEEP logs its action too', async () => {
    await exchange('user-1', 'KEEP', { keep: ITEMS.map((q) => q.id), page: '0', _action: 'next' }, TOKEN);
    expect(actionLogs().map(([, m]) => m)).toEqual([
      expect.objectContaining({ screen: 'KEEP', action: 'next' }),
    ]);
  });
});
