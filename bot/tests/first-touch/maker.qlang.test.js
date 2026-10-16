'use strict';
/**
 * The question language the page shows (manager's ruling on quizzes.language): nothing writes quizzes.language.
 * qlang = quizzes.language when set; else the backfill's decideLanguage over the question texts WHEN it equals
 * today's read-aloud voice language (question text + first option); else null (no mark, no clause, no class line).
 * The tree reads quiz_questions once per build (cached with it); the make uses the same qlang.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const QLang = require('../../shared/services/first-touch/maker.qlang');
const Backfill = require('../../scripts/quiz/backfill-quiz-language');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, qid } = require('./maker-fixture');

const EN_Q = (i) => `What is ${i} + ${i}?`;
const UR_Q = (i) => `${i} جمع ${i} کتنے ہوتے ہیں؟`;
function questions(quizId, text, optionA) {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `${quizId.slice(0, 30)}${String(i).padStart(6, '0')}`, quiz_id: quizId, question_text: text(i), option_a: optionA(i), sort_order: i + 1,
  }));
}

let fake;
function seed() {
  fake = seedMaker(supabase);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
  require('../../shared/services/quiz/web-quiz-link')._resetCache();
  const others = fake.db.quiz_questions.filter((q) => ![qid(2), qid(4), qid(5)].includes(q.quiz_id));
  fake.db.quiz_questions = [
    ...others,
    ...questions(qid(2), EN_Q, (i) => (i === 0 ? 'تین' : String(i))),   // 10/10 English, an Urdu first option → disagree
    ...questions(qid(4), UR_Q, () => 'ہاں'),                              // Urdu → ur
    ...questions(qid(5), UR_Q, () => 'ہاں'),                              // language 'en' set → 'en' wins
  ];
}
beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('maker.qlang (pure)', () => {
  test('the script uses the very same functions', () => {
    expect(Backfill.decideLanguage).toBe(QLang.decideLanguage);
    expect(Backfill.voiceLanguage).toBe(QLang.voiceLanguage);
  });
  test('set language wins; else decided only when it equals the voice; else null', () => {
    const en = Array.from({ length: 3 }, (_, i) => ({ question_text: EN_Q(i), option_a: '1' }));
    const ur = Array.from({ length: 3 }, (_, i) => ({ question_text: UR_Q(i), option_a: 'ہاں' }));
    expect(QLang.qlangFor('ur', en)).toBe('ur');
    expect(QLang.qlangFor(null, en)).toBe('en');
    expect(QLang.qlangFor(null, ur)).toBe('ur');
    expect(QLang.qlangFor(null, [{ ...en[0], option_a: 'تین' }, en[1], en[2]])).toBeNull();
    expect(QLang.qlangFor(null, [])).toBeNull();
    expect(QLang.qlangFor('fr', [])).toBeNull();
  });
});

describe('the chip tree and the make', () => {
  test('10/10 English questions with an Urdu first option → no mark; a Urdu quiz → ur; a set language wins', async () => {
    const tree = await Bank.chipTree();
    expect(tree[4].maths[0]).toMatchObject({ quizId: qid(2), qlang: null });
    expect(tree[1].islamic_studies[0]).toMatchObject({ quizId: qid(4), qlang: 'ur' });
    expect(tree[3].general_knowledge[0]).toMatchObject({ quizId: qid(5), qlang: 'en' });
  });

  test('quiz_questions read once per tree build, only for the quizzes with no language; cached with the tree', async () => {
    await Bank.chipTree();
    const reads = fake.calls.filter((c) => c.table === 'quiz_questions');
    expect(reads.length).toBe(1);
    await Bank.chipTree();
    expect(fake.calls.filter((c) => c.table === 'quiz_questions').length).toBe(1);
  });

  describe('through the routes', () => {
    let srv;
    const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
    const H = { 'x-api-key': process.env.INTERNAL_API_KEY };
    beforeEach(async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
      await new Promise((r) => { srv = app.listen(0, r); });
    });
    afterEach(() => new Promise((r) => srv.close(r)));

    test('a page open and a make leave the quizzes table byte-identical; the make uses the derived qlang', async () => {
      const before = JSON.stringify(fake.db.quizzes);
      const t = MakerToken.signMaker({ uid: TEACHER.id, lang: 'ur', tour: 0, via: 'menu' });
      expect((await fetch(url(`/m/${t}`), { headers: H })).status).toBe(200);
      const res = await fetch(url('/api/ft/make'), {
        method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ t, grade: '1', subject: 'islamic_studies', quizId: qid(4) }),
      });
      const out = await res.json();
      expect(out.qlang).toBe('ur');
      expect(out.message.endsWith(`\n\n${str('class.lang.ur', 'ur')}`)).toBe(true);
      const disagree = await (await fetch(url('/api/ft/make'), {
        method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ t, grade: '4', subject: 'maths', quizId: qid(2) }),
      })).json();
      expect(disagree.qlang).toBeNull();
      expect(disagree.message).not.toContain(str('class.lang.en', 'ur'));
      expect(JSON.stringify(fake.db.quizzes)).toBe(before);
      expect(fake.calls.filter((c) => c.table === 'quizzes' && c.op !== 'select')).toEqual([]);
    });
  });
});
