'use strict';
/**
 * The ready screen (FIRST_QUIZ §3.3, §4, §7.2) and the question-language mark (§3.2): the page rendered in its
 * "ready" state carries exactly {mk.ready.h, mk.ready.sub.lang, mk.ready.q, mk.send, mk.send.note, mk.copy, mk.next}
 * (no mk.report: the manager's §7.4 ruling), in English and Urdu, with both "Send to class group" and "Copy the
 * message"; never "your lesson" or a test word; mk.ready.sub.lang composed from the signed copy (the language clause
 * dropped when the quiz's language is unknown). Topic chips carry EN / «اردو» from the quiz's question language;
 * unknown → no mark.
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
const Page = require('../../shared/services/first-touch/maker.page');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, qid } = require('./maker-fixture');

const READY_IDS = ['mk.copy', 'mk.next', 'mk.ready.h', 'mk.ready.q', 'mk.ready.sub.lang', 'mk.send', 'mk.send.note'];
const TEST_WORD = /\b(test|exam|assessment)\b|امتحان|ٹیسٹ/i;
const SC = 'e1000000-0000-4000-8000-000000000001';
const MSG = 'Amina Testwala shared a quiz: Fractions\nhttps://quiz.example/q/ABCDEF';
const TREE = { 4: { maths: [{ quizId: qid(2), topic: 'Fractions', qlang: 'en' }] } };
const ready = (o = {}) => ({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: 'en', message: MSG, preview: 'What is 1/2 of 4?', total: 10, shareCodeId: SC, ...o });
const page = (lang, o) => Page.buildMakerPage({ token: 'tok.en', lang, via: 'menu', tree: TREE, ready: ready(o) }).html;
const readySection = (html) => /<section data-screen="ready"[^>]*>([\s\S]*?)<\/section>/.exec(html)[1];
const idsIn = (s) => [...new Set([...s.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]))].sort();
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

describe('the ready screen (rendered server-side in its "ready" state)', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: exactly the seven ids, visible, both share buttons; no mk.report`, () => {
      const html = page(lang);
      const sec = readySection(html);
      expect(idsIn(sec)).toEqual(READY_IDS);
      expect(html).toMatch(/<section data-screen="ready">/);   // shown, not hidden
      expect(sec).toContain(str('mk.send', lang));
      expect(sec).toContain(str('mk.copy', lang));
      expect(sec).toContain(`href="/m/tok.en/send?c=${SC}"`);
      expect(html).not.toContain('Your class report arrives here');
      expect(html).not.toContain('کلاس کی رپورٹ یہیں');
      expect(html).not.toContain('mk.report');
    });

    test(`${lang}: no "your lesson", no test word`, () => {
      const html = page(lang);
      expect(html).not.toMatch(/your lesson/i);
      expect(html).not.toContain('آپ کا سبق');
      expect(strip(readySection(html))).not.toMatch(TEST_WORD);
    });
  }

  test('mk.ready.sub.lang (EN) composed from the signed copy, with the REAL subject label', () => {
    expect(Page.readySubText({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: 'en', lang: 'en' }))
      .toBe('Grade 4 Mathematics · Fractions · questions in English · a ready quiz from the NIETE library');
    expect(Page.readySubText({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: 'ur', lang: 'en' }))
      .toBe('Grade 4 Mathematics · Fractions · questions in Urdu · a ready quiz from the NIETE library');
    expect(Page.readySubText({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: null, lang: 'en' }))
      .toBe('Grade 4 Mathematics · Fractions · a ready quiz from the NIETE library');
  });

  test('mk.ready.sub.lang (UR) = the signed sentence, byte for byte; unknown language → the clause dropped', () => {
    expect(Page.readySubText({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: 'en', lang: 'ur' }))
      .toBe('جماعت ۴، ریاضی: ⁦Fractions⁩۔ سوال انگریزی میں ہیں۔ ⁦NIETE⁩ لائبریری کا تیار کوئز۔');
    expect(Page.readySubText({ grade: '4', subject: 'maths', topic: 'Fractions', qlang: null, lang: 'ur' }))
      .toBe('جماعت ۴، ریاضی: ⁦Fractions⁩۔ ⁦NIETE⁩ لائبریری کا تیار کوئز۔');
  });

  test('the Urdu ready screen: topic in <bdi>, «سوال انگریزی میں ہیں», Urdu-Indic question count', () => {
    const sec = readySection(page('ur'));
    expect(sec).toMatch(/<bdi[^>]*>Fractions<\/bdi>/);
    expect(sec).toContain('سوال انگریزی میں ہیں');
    expect(strip(sec)).toContain('سوال نمبر ۱ از ۱۰');
    expect(sec).toContain('What is 1/2 of 4?');
  });

  test('the English ready screen: "Question 1 of 10", the preview, the message in a read-only block', () => {
    const sec = readySection(page('en'));
    expect(strip(sec)).toContain('Question 1 of 10');
    expect(sec).toContain('What is 1/2 of 4?');
    expect(sec).toMatch(/id="mk-msg"[^>]*>Amina Testwala shared a quiz: Fractions/);
    expect(sec).not.toMatch(/<textarea|<input(?![^>]*type="hidden")/i);
  });

  test('the live page carries the ready screen hidden, with the same ids and no mk.report', () => {
    const html = Page.buildMakerPage({ token: 'tok.en', lang: 'en', via: 'menu', tree: TREE }).html;
    expect(html).toMatch(/<section data-screen="ready" hidden>/);
    expect(idsIn(readySection(html))).toEqual(READY_IDS);
  });
});

describe('the question-language mark on the topic chips (through GET /m/:token)', () => {
  let srv;
  let fake;
  const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
  const get = async (t) => (await fetch(url(`/m/${t}`), { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } })).text();
  const tok = (lang) => MakerToken.signMaker({ uid: TEACHER.id, lang, tour: 0, via: 'menu' });
  const chip = (html, id) => new RegExp(`<button[^>]*data-quiz="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(html)[1];
  const MARK_EN = new RegExp(`class="mk-mark"[^>]*>${str('mk.topic.mark.en', 'en')}<`);
  const MARK_UR = new RegExp(`class="mk-mark"[^>]*>${str('mk.topic.mark.ur', 'ur')}<`);
  beforeEach(async () => {
    jest.clearAllMocks();
    fake = seedMaker(supabase);
    IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
    const app = express();
    app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  test('a Grade-4 Maths quiz with language "en" on the Urdu page → "EN" on its chip', async () => {
    fake.db.quizzes.find((q) => q.id === qid(2)).language = 'en';
    const html = await get(tok('ur'));
    expect(chip(html, qid(2))).toMatch(MARK_EN);
    expect(chip(html, qid(2))).toContain('<bdi>Fractions</bdi>');
  });

  test('a quiz with language "ur" → «اردو» on its chip (English page too)', async () => {
    expect(chip(await get(tok('en')), qid(11))).toMatch(MARK_UR);
  });

  test('NULL language and no question text to read → no mark', async () => {
    fake.db.quiz_questions = fake.db.quiz_questions.filter((q) => q.quiz_id !== qid(4));
    const html = await get(tok('en'));
    expect(chip(html, qid(4))).not.toContain('mk-mark');
  });
});
