'use strict';
/**
 * A reminder for two classes opens the phone's hub (/h/…?from=push → src 'push'), and its "Who is playing?" marked
 * nobody: the children the reminder was for looked the same as the rest. The hub opened from a reminder now asks
 * class-link's roundsReadyForPhone(device_ref, PKT day, {withKids:true}) and marks each child still waiting on a round
 * with class-link's own field (`round: true`, as /j/'s "Whose turn?" chips), by chip id only: no name is added (the
 * hub already lists these children). Any other hub answer is the same object, and nothing is asked.
 * The hub's own build and class-link are the faked boundaries (module spies); the internal router runs whole.
 * Invented children only.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const T = require('../../shared/services/quiz/web-quiz-token');
const ClassLink = require('../../shared/services/quiz/web-quiz-class-link');
const Hub = require('../../shared/services/quiz/web-quiz-hub');

const DEV = 'CCCCCCCCCCCCCCCCCCCCCC';
const SARA = '11111111-1111-4111-8111-111111111111';
const FATIMA = '22222222-2222-4222-8222-222222222222';
const ALI = '33333333-3333-4333-8333-333333333333';
const chip = (id) => T.chipId('h', id);
const kidsOf = () => [SARA, FATIMA, ALI].map((id, i) => ({ chip: chip(id), first: ['Sara', 'Fatima', 'Ali'][i], animal: 'owl', grade: 3 }));
const hubAnswer = () => ({ lang: 'en', kids: kidsOf(), kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'jugnu' });
const R3 = { class_link_code: 'K7Q2MX', class_id: 'c3', class_label_en: 'Class 3 A', round_code: 'QRA22N', kids: [{ student_id: SARA }] };
const R4 = { class_link_code: 'P3W8TT', class_id: 'c4', class_label_en: 'Class 4 A', round_code: 'QRB33M', kids: [{ student_id: FATIMA }] };
const marked = (out) => out.kids.filter((k) => k.round === true).map((k) => k.first);

let rounds;
beforeEach(() => {
  const fake = makeFake({ app_settings: [] });
  supabase.from = (t) => fake.from(t);
  rounds = jest.spyOn(ClassLink, 'roundsReadyForPhone').mockImplementation(async () => [R3, R4]);
});
afterEach(() => jest.restoreAllMocks());

describe('carry: the hub a reminder opened marks who the reminder was for', () => {
  const Ready = () => require('../../shared/services/quiz/web-quiz-hub-ready');
  const NOW = Date.parse('2026-11-23T13:10:00Z'); // 18:10 PKT, Monday

  test('from=push, two classes waiting: Sara and Fatima marked, Ali not; asked once as this phone, PKT day, withKids', async () => {
    const out = await Ready().carry(Promise.resolve(hubAnswer()), { src: 'push', device: DEV, now: NOW });
    expect(marked(out)).toEqual(['Sara', 'Fatima']);
    expect(rounds).toHaveBeenCalledTimes(1);
    expect(rounds).toHaveBeenCalledWith(DEV, '2026-11-23', { withKids: true });
  });
  test('PKT day, not UTC day: 20:30Z Sunday is Monday in Pakistan', async () => {
    await Ready().carry(Promise.resolve(hubAnswer()), { src: 'push', device: DEV, now: Date.parse('2026-11-22T20:30:00Z') });
    expect(rounds).toHaveBeenCalledWith(DEV, '2026-11-23', { withKids: true });
  });
  test('only the marks change: names, order and every other field are the hub\'s own', async () => {
    const a = hubAnswer();
    const out = await Ready().carry(Promise.resolve(a), { src: 'push', device: DEV, now: NOW });
    expect(out.kids.map(({ round, ...k }) => k)).toEqual(a.kids);
    const { kids, ...rest } = out;
    const { kids: k0, ...rest0 } = a;
    expect(rest).toEqual(rest0);
    expect(JSON.stringify(out)).not.toContain(SARA); // a student id never leaves the bot
  });
  test('no from=push: the same object, nothing asked', async () => {
    const a = hubAnswer();
    for (const src of [undefined, 'link', 'hs', 'class_link']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await Ready().carry(Promise.resolve(a), { src, device: DEV, now: NOW })).toBe(a);
    }
    expect(rounds).not.toHaveBeenCalled();
  });
  test('rounds [] (switch off, nothing waiting): no child marked', async () => {
    rounds.mockImplementation(async () => []);
    const out = await Ready().carry(Promise.resolve(hubAnswer()), { src: 'push', device: DEV, now: NOW });
    expect(marked(out)).toEqual([]);
    expect(out.kids).toEqual(hubAnswer().kids);
  });
  test('a waiting child this hub does not list: no mark, no new chip', async () => {
    rounds.mockImplementation(async () => [{ ...R3, kids: [{ student_id: '44444444-4444-4444-8444-444444444444' }] }]);
    const out = await Ready().carry(Promise.resolve(hubAnswer()), { src: 'push', device: DEV, now: NOW });
    expect(out.kids).toHaveLength(3);
    expect(marked(out)).toEqual([]);
  });
  test('locked, no children, or no device: the same object, nothing asked', async () => {
    const locked = { lang: 'en', locked: true, kids: [], kid: null };
    expect(await Ready().carry(Promise.resolve(locked), { src: 'push', device: DEV, now: NOW })).toBe(locked);
    const a = hubAnswer();
    expect(await Ready().carry(Promise.resolve(a), { src: 'push', device: undefined, now: NOW })).toBe(a);
    expect(rounds).not.toHaveBeenCalled();
  });
  test('class-link throws: the hub as it came', async () => {
    rounds.mockImplementation(async () => { throw new Error('redis down'); });
    const a = hubAnswer();
    expect(await Ready().carry(Promise.resolve(a), { src: 'push', device: DEV, now: NOW })).toBe(a);
  });
});

describe('through the internal router: GET (the page render) and POST (the page\'s own call)', () => {
  let srv; let base; let spy;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../shared/routes/web-quiz-internal.routes'));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  beforeEach(() => { spy = jest.spyOn(Hub, 'hub').mockImplementation(async () => hubAnswer()); });
  afterAll(() => srv && srv.close());
  const H = { 'x-api-key': process.env.INTERNAL_API_KEY };
  const get = (q, dev = DEV) => fetch(`${base}/api/internal/wq/hub/tok.en${q}`, { headers: { ...H, ...(dev ? { 'x-wq-device': dev } : {}) } }).then((r) => r.json());
  const post = (b) => fetch(`${base}/api/internal/wq/hub/tok.en`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

  test('GET ?src=push: the two waiting children marked', async () => {
    expect(marked(await get('?src=push'))).toEqual(['Sara', 'Fatima']);
    expect(rounds).toHaveBeenCalledWith(DEV, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), { withKids: true });
  });
  test('POST {src:"push", device_ref}: marked too (a first open with no cookie asks again as the phone)', async () => {
    expect(marked(await post({ device_ref: DEV, src: 'push' }))).toEqual(['Sara', 'Fatima']);
  });
  test('GET with no src, another src, or POST without src: no marks, class-link never asked', async () => {
    for (const out of [await get(''), await get('?src=link'), await post({ device_ref: DEV })]) {
      expect(out.kids).toEqual(hubAnswer().kids);
    }
    expect(rounds).not.toHaveBeenCalled();
  });
});
