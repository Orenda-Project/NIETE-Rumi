'use strict';
/**
 * The pictures a child's share carries: the card, the class, the school board
 * and the invite. One template (HTML a headless browser photographs), one id
 * scheme (signed, so nobody can make the server draw arbitrary things), one
 * cache (R2 by content hash). Mocked only at the network boundary: Supabase,
 * R2 and the browser screenshot.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), headObject: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));

const express = require('express');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const { renderArt, SIZES } = require('../../../shared/templates/web-quiz-art.template');
const Art = require('../../../shared/services/quiz/web-quiz-art');

const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const CLASSMATE = 'Zarvish Testwala';

function seed() {
  const now = Date.now();
  return {
    quiz_share_codes: [
      { id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', teacher_name: 'Teacher A', topic: 'Fractions', language: 'en', active: true },
      { id: 'sc-ch', code: 'CHAL01', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: 'en', active: true, invited_by_student_id: 'st-1', parent_share_code_id: 'sc-1' },
    ],
    quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', meta: {} }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: CLASSMATE }],
    quiz_sessions: [
      { id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() },
      { id: 's-2', quiz_id: 'qz-1', student_id: 'st-2', student_name: CLASSMATE, share_code_id: 'sc-1', status: 'completed', correct_answers: 8, total_questions_answered: 8, mastery_percentage: 100, completed_at: new Date(now - 30000).toISOString(), created_at: new Date(now - 200000).toISOString() },
    ],
    app_settings: [],
    // the school league (web-quiz-schools.js) reads these
    users: [{ id: 't-1', school_id: 'SA' }, { id: 't-2', school_id: 'SB' }],
    schools: [
      { id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false },
      { id: 'SB', name: 'School Bravo', region: 'Sector Two', is_active: true, is_probable_test: false },
    ],
  };
}

let fake;
beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'art-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  fake = makeFake(seed());
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Art._resetCache();
  require('../../../shared/services/quiz/web-quiz-schools')._reset();
  r2.downloadFromR2.mockReset().mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
  r2.uploadBuffer.mockReset().mockResolvedValue('https://r2/x');
  r2.headObject.mockReset().mockResolvedValue({ exists: false });
  htmlToImage.mockReset().mockImplementation(async (html, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer());
});

describe('the template', () => {
  const card = { first: 'Amal', correct: 7, total: 8, topic: 'Fractions', cls: 'Class 3' };

  test('two sizes, each the exact box a share needs: 1200×630 preview, 1080×1080 file', () => {
    expect(SIZES).toEqual({ og: [1200, 630], sq: [1080, 1080] });
    for (const size of ['og', 'sq']) {
      const html = renderArt({ kind: 'card', size, brand: 'niete', lang: 'en', d: card });
      const [w, h] = SIZES[size];
      expect(html).toContain(`width:${w}px;height:${h}px`);
      expect(html).toContain('class="art');
    }
  });

  test('EN card: the name, the score as one LTR run, the topic, the stars drawn not typed', () => {
    const html = renderArt({ kind: 'card', size: 'og', brand: 'niete', lang: 'en', d: card });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('>Amal<');
    expect(html).toMatch(/class="num"[^>]*>7\/8</);
    expect(html).toContain('Fractions');
    expect((html.match(/<svg class="star on"/g) || []).length).toBe(7);
    expect((html.match(/<svg class="star"/g) || []).length).toBe(1);
    expect(html).not.toMatch(/[★⭐]/);
  });

  test('UR: mirrored card, Nastaliq embedded, numbers isolate AND run left-to-right', () => {
    const html = renderArt({ kind: 'invite', size: 'sq', brand: 'niete', lang: 'ur', d: { first: 'Amal', correct: 7, total: 8, topic: 'کسریں' } });
    expect(html).toContain('<html lang="ur" dir="rtl">');
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{1000}/);
    expect(html).toMatch(/\.num\{[^}]*unicode-bidi:isolate[^}]*direction:ltr/);
    expect(html).toContain('چیلنج');
    // A Latin name typed into an Urdu quiz keeps its own direction.
    expect(html).toContain('<bdi dir="ltr">Amal</bdi>');
  });

  test('the brand switch: Rumi tokens and mark, never the NIETE ones', () => {
    const rumi = renderArt({ kind: 'card', size: 'og', brand: 'rumi', lang: 'en', d: card });
    expect(rumi).toContain('#0E2058');
    expect(rumi).toContain('#F06E42');
    expect(rumi).not.toContain('#47BA7D');
    const niete = renderArt({ kind: 'card', size: 'og', brand: 'nope', lang: 'en', d: card });
    expect(niete).toContain('#47BA7D');
  });

  test('the class picture carries numbers, never a classmate', () => {
    const html = renderArt({ kind: 'class', size: 'og', brand: 'niete', lang: 'en', d: { topic: 'Fractions', cls: 'Class 3', played: 18, avgPct: 74, top: { correct: 8, total: 8 } } });
    expect(html).toContain('>18<');
    expect(html).toContain('74%');
    expect(html).toContain('Not played yet?');
  });

  test("the school picture: the viewer's school highlighted among its neighbours, moves drawn", () => {
    const rows = [
      { rank: 4, name: 'School North', sector: 'B.K', points: 1400, kids: 90, move: 1 },
      { rank: 5, name: 'School Here', sector: 'Sihala', points: 1240, kids: 87, move: 2, you: true },
      { rank: 6, name: 'School South', sector: 'Urban-I', points: 900, kids: 60, move: -1 },
    ];
    const html = renderArt({ kind: 'school', size: 'sq', brand: 'niete', lang: 'en', d: { rows } });
    expect(html).toMatch(/<li class="row you"[^>]*>[\s\S]*School Here/);
    expect(html).toContain('1,240');
    expect(html).toContain('class="mv up"');
    expect(html).toContain('class="mv down"');
    expect(html).toContain('10 points for playing');
  });

  test('HTML snapshot (fonts stubbed): the layout is reviewed, not drifted', () => {
    const html = renderArt({ kind: 'invite', size: 'og', brand: 'niete', lang: 'en', d: { first: 'Amal', correct: 7, total: 8, topic: 'Fractions' } }, { fonts: false, pictures: false });
    expect(html).toMatchSnapshot();
  });
});

describe('the id: signed, short, one per thing', () => {
  test('round trip for each kind; a tampered or foreign id is refused', () => {
    const c = Art.artId('c', SID);
    expect(c).toMatch(/^c\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{12}$/);
    expect(Art.parseArtId(c)).toEqual({ kind: 'c', ref: SID });
    expect(Art.parseArtId(Art.artId('i', 'CHAL01'))).toEqual({ kind: 'i', ref: 'CHAL01' });
    expect(Art.parseArtId(Art.artId('l', 'CLS001'))).toEqual({ kind: 'l', ref: 'CLS001' });
    expect(Art.parseArtId(`${c.slice(0, -1)}${c.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(Art.parseArtId('l.CLS002.' + c.split('.')[2])).toBeNull();
    expect(Art.parseArtId('x.CLS001.aaaaaaaaaaaa')).toBeNull();
    expect(Art.parseArtId(null)).toBeNull();
  });
});

describe('render + cache', () => {
  test('card: rendered once as a JPEG of the asked size, cached in R2 by content hash, then served from R2', async () => {
    const id = Art.artId('c', SID);
    const one = await Art.artImage(id, { size: 'og' });
    expect(one.contentType).toBe('image/jpeg');
    const meta = await sharp(one.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630]);
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toContain('>Amal<');
    expect(html).toContain('7/8');
    expect(html).toContain('<img class="ani"');
    expect(html).not.toContain('Zarvish');
    expect(r2.uploadBuffer).toHaveBeenCalledWith(one.bytes, expect.stringMatching(/^wq-art\/[0-9a-f]{32}\.jpg$/), 'image/jpeg');

    // Another process (no memory cache): R2 has it, nothing is drawn.
    Art._resetCache();
    r2.headObject.mockResolvedValueOnce({ exists: true });
    r2.downloadFromR2.mockResolvedValueOnce(one.bytes);
    const two = await Art.artImage(id, { size: 'og' });
    expect(two.bytes.equals(one.bytes)).toBe(true);
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    expect(r2.downloadFromR2).toHaveBeenLastCalledWith(r2.uploadBuffer.mock.calls[0][1]);
  });

  test("the card names the child's school and the points this play added to it", async () => {
    await Art.artImage(Art.artId('c', SID), { size: 'og' });
    expect(htmlToImage.mock.calls[0][0]).toMatch(/<p class="pts"><span class="num">\+\d+<\/span> points for <bdi dir="ltr">School Alpha<\/bdi><\/p>/);
  });

  test("the school picture: my school among its neighbours, highlighted; schools only, no child or teacher", async () => {
    await Art.artImage(Art.artId('s', 'CLS001'), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toMatch(/<li class="row you">[\s\S]*School Alpha/);
    expect(html).not.toMatch(/Amal|Zarvish|Teacher A/);
  });

  test("a school with no points yet still gets its picture: the leaders and its own row", async () => {
    fake.db.users[0].school_id = 'SB';
    fake.db.users.push({ id: 't-3', school_id: 'SA' });
    fake.db.quiz_share_codes.push({ id: 'sc-2', code: 'CLS002', quiz_id: 'qz-1', teacher_user_id: 't-3', topic: 'Fractions', language: 'en', active: true });
    await Art.artImage(Art.artId('s', 'CLS002'), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toMatch(/<li class="row">[\s\S]*School Bravo/);
    expect(html).toMatch(/<li class="row you">[\s\S]*School Alpha/);
  });

  test("an invited friend's card names neither the challenger's class nor their school", async () => {
    const FRIEND = '2b3c4d5e-0000-4000-8000-00000000f00d';
    fake.db.students.push({ id: 'st-f', student_name: 'Rafi Testwala' });
    fake.db.quiz_sessions.push({ id: FRIEND, quiz_id: 'qz-1', student_id: 'st-f', student_name: 'Rafi Testwala', share_code_id: 'sc-1', invited_by_student_id: 'st-1', status: 'completed', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75, completed_at: new Date().toISOString(), created_at: new Date().toISOString() });
    await Art.artImage(Art.artId('c', FRIEND), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toContain('>Rafi<');
    expect(html).not.toContain('School Alpha');
    expect(html).not.toMatch(/My score<span class="dot">/);
  });

  test("a practice round's card shows the kept first-try score, the one the league shows", async () => {
    fake.db.quiz_sessions.push({ id: '1a2b3c4d-0000-4000-8000-000000003333', quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 8, total_questions_answered: 8, completed_at: new Date().toISOString(), created_at: new Date().toISOString() });
    await Art.artImage(Art.artId('c', '1a2b3c4d-0000-4000-8000-000000003333'), { size: 'sq' });
    expect(htmlToImage.mock.calls[0][0]).toContain('7/8');
    expect(htmlToImage.mock.calls[0][1]).toMatchObject({ width: 1080, height: 1080 });
  });

  test('invite: from the challenge code, the challenger\'s counted score from the DB', async () => {
    await Art.artImage(Art.artId('i', 'CHAL01'), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toMatch(/Can you beat <bdi dir="ltr">Amal<\/bdi>'s <span class="num">7\/8<\/span>\?/);
    expect(html).toContain('>Amal<');
    expect(html).toContain('7/8');
  });

  test('class from the class code: places, animals and scores, no child named', async () => {
    await Art.artImage(Art.artId('l', 'CLS001'), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toContain('>2<');
    expect(html).toContain('94%');
    expect(html).toContain('8/8');
    expect((html.match(/<img class="ani"/g) || []).length).toBe(2);
    expect(html).not.toContain('Zarvish');
    expect(html).not.toContain('Amal');
  });

  test("class shared by a child: the same rows, and only the sharer's own row named \"(me)\"", async () => {
    await Art.artImage(Art.artId('l', SID), { size: 'og' });
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toMatch(/<li class="me">[\s\S]*Amal[\s\S]*\(me\)/);
    expect(html).not.toContain('Zarvish');
  });

  test('an unfinished session or an unknown thing: 404, nothing drawn', async () => {
    fake.db.quiz_sessions[0].status = 'in_progress';
    await expect(Art.artImage(Art.artId('c', SID), { size: 'og' })).rejects.toMatchObject({ status: 404 });
    await expect(Art.artImage('c.nope.nope', { size: 'og' })).rejects.toMatchObject({ status: 404 });
    expect(htmlToImage).not.toHaveBeenCalled();
  });

  test('R2 down: the picture is still served (drawn), the failure only logged', async () => {
    r2.uploadBuffer.mockRejectedValue(new Error('r2 down'));
    const out = await Art.artImage(Art.artId('l', 'CLS001'), { size: 'og' });
    expect(out.bytes.length).toBeGreaterThan(100);
  });
});

describe('over HTTP', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('GET /art/:id → the JPEG, cacheable by anyone (a link preview has no session)', async () => {
    const r = await fetch(`${base}/art/${Art.artId('l', 'CLS001')}?f=sq`, { headers: { 'x-api-key': 'art-key' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toBe('public, max-age=600');
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1080]);
  });

  test('a bad id: 404 JSON', async () => {
    const r = await fetch(`${base}/art/c.bad.bad`, { headers: { 'x-api-key': 'art-key' } });
    expect(r.status).toBe(404);
  });
});

test("the share events keep the two new paths: the picture shared as a file, and saved", () => {
  const { cleanEvent } = require('../../../shared/services/quiz/web-quiz.service');
  expect(cleanEvent({ n: 'share_click', path: 'file', src: 'card' })).toEqual({ name: 'share_click', props: { src: 'card', path: 'file' } });
  expect(cleanEvent({ n: 'share_click', path: 'save', src: 'table' }).props.path).toBe('save');
});
