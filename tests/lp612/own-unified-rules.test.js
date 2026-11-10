'use strict';
/**
 * bd-snkn32.19 — one "Make my own" flow for grades 1–12 (unified spec items 9–11 + Grade 8 exam practice).
 *
 * Same flow at every grade; only the option lists differ by band. Grades 6–12 never see a primary way. The gradual
 * release (I do → We do → You do) is never removed or skipped, and rote drill is never offered or accepted: the rules
 * ride in every instruction (make and change, 1–5 and 6–12), and a change that asks for either is refused up front.
 */
const {
  waysOfBand, waysOfGrade, purposesOfGrade, PURPOSE_FDE, SECONDARY_WAYS, GRR_LINE, ROTE_LINE,
} = require('../../bot/shared/services/lp612-own-ways');
const { parseOwnAnswers, buildOwnInstruction, WAYS } = require('../../bot/shared/services/lp612-own-instruction');
const { buildEditInstruction, k5EditMessages } = require('../../bot/shared/services/lp-own-edit-instruction');
const { k5Messages, system } = require('../../bot/shared/services/lp-k5-own');
const G = require('../../bot/shared/services/lp-own-edit-guard');

const base = { size: '51_70', resources: ['board', 'charts', 'objects', 'audio'], level: 'mixed', note: '' };
const G7 = 'grade_7_science.c02.p010-012';
const G8 = 'grade_8_science.c01.p001-003';
const G10 = 'grade_10_urdu.c01.p001-004';
const SCRIPT = { goal: 'Count to 10', meta: { day: 3 }, hook: { say: 'h' }, iDo: { steps: ['a'] }, weDo: { say: 'w' }, youDo: { say: 'y' }, wrap: { say: 'z' } };

describe('ways (spec item 9 + Grade 8 exam practice)', () => {
  it('writing is offered in 6–8 and 9–12, and its text is model, plan, write, check', () => {
    expect(waysOfBand('middle')).toContain('writing');
    expect(waysOfBand('senior')).toContain('writing');
    expect(SECONDARY_WAYS.writing).toMatch(/models a short text/);
    expect(SECONDARY_WAYS.writing).toMatch(/checks it against 3 points/);
  });
  it('writing is accepted for Grade 10 Urdu', () => {
    expect(parseOwnAnswers({ ...base, way: 'writing' }, { segmentId: G10 }).ok).toBe(true);
  });
  it('Grade 8 gets FDE exam practice; Grades 6 and 7 do not; no past paper (FBISE) at Grade 8', () => {
    expect(waysOfGrade(8)).toContain('exam_fde');
    expect(waysOfGrade(8)).not.toContain('past_paper');
    expect(waysOfGrade(7)).not.toContain('exam_fde');
    expect(waysOfGrade(6)).not.toContain('exam_fde');
    expect(waysOfGrade(10)).not.toContain('exam_fde');
    expect(waysOfGrade(10)).toContain('past_paper');
    expect(waysOfGrade(3)).toEqual([]);
    expect(SECONDARY_WAYS.exam_fde).toMatch(/FDE/);
    expect(SECONDARY_WAYS.exam_fde).toMatch(/never memorised answers/);
  });
  it('the bot accepts exam_fde for a Grade 8 segment and refuses it for Grade 7 and Grade 10', () => {
    expect(parseOwnAnswers({ ...base, way: 'exam_fde' }, { segmentId: G8 }).ok).toBe(true);
    expect(parseOwnAnswers({ ...base, way: 'exam_fde' }, { grade: 8 }).ok).toBe(true);
    expect(parseOwnAnswers({ ...base, way: 'exam_fde' }, { segmentId: G7 }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'exam_fde' }, { segmentId: G10 }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'past_paper' }, { segmentId: G8 }).ok).toBe(false);
  });
  it('Grade 8 exam practice: the purpose board is accepted at Grade 8 (FDE), never at 6–7', () => {
    expect(parseOwnAnswers({ ...base, way: 'exam_fde', purpose: 'board' }, { segmentId: G8 }).ok).toBe(true);
    expect(parseOwnAnswers({ ...base, way: 'worked', purpose: 'board' }, { segmentId: G7 }).ok).toBe(false);
    expect(purposesOfGrade(8)).toEqual(['new', 'revise', 'board', 'reteach']);
    expect(purposesOfGrade(7)).toEqual(['new', 'revise', 'reteach']);
    expect(purposesOfGrade(10)).toEqual(['new', 'revise', 'board', 'reteach']);
  });
  it('the portal\'s Grade 8 "Exam practice (FDE)" answers (rules.ts waysFor/purposesFor) make a plan', () => {
    // The exact body the portal sends for a Grade 8 Science lesson with Exam practice picked for purpose and way.
    const body = { size: '31_50', resources: ['board', 'charts'], level: 'on_track', way: 'exam_fde', note: '', purpose: 'board' };
    const parsed = parseOwnAnswers(body, { segmentId: G8 });
    expect(parsed).toEqual({ ok: true, answers: expect.objectContaining({ way: 'exam_fde', purpose: 'board' }) });
    const text = buildOwnInstruction(parsed.answers, { segmentId: G8 });
    expect(text).toMatch(/FDE Grade 8 centralised annual exam/);
    expect(text).toContain(PURPOSE_FDE);
    expect(text).not.toMatch(/FBISE/);
  });
  it('board practice at 9–12 still reads FBISE', () => {
    const parsed = parseOwnAnswers({ ...base, way: 'past_paper', purpose: 'board' }, { segmentId: G10 });
    expect(buildOwnInstruction(parsed.answers, { segmentId: G10 })).toMatch(/FBISE past-paper style/);
  });
  it('no primary way at Grade 8', () => {
    for (const w of Object.keys(WAYS)) expect(parseOwnAnswers({ ...base, way: w }, { segmentId: G8 }).ok).toBe(false);
  });
  it('past-paper practice is reasoning and model answers, never memorised answers', () => {
    expect(SECONDARY_WAYS.past_paper).toMatch(/reasoning/);
    expect(SECONDARY_WAYS.past_paper).toMatch(/never memorised answers/);
  });
});

describe('instruction rules (spec item 10)', () => {
  const g612 = (way = 'worked', ctx = { segmentId: G7 }) => buildOwnInstruction(parseOwnAnswers({ ...base, way }, ctx).answers, ctx);
  const k5 = () => buildOwnInstruction(parseOwnAnswers({ ...base, way: 'tarl' }).answers);

  it('6–12 resources read as secondary things; 1–5 keep the primary words', () => {
    expect(g612()).toMatch(/charts or diagrams/);
    expect(g612()).toMatch(/lab things or models \(magnets, beakers, a globe, a ruler\)/);
    expect(g612()).toMatch(/a phone \(video or audio\)/);
    expect(g612()).not.toMatch(/stones, sticks|flashcards/);
    expect(k5()).toMatch(/charts or flashcards/);
    expect(k5()).toMatch(/stones, sticks, bottle caps/);
  });
  it('the GRR and rote lines are in every make instruction, 1–5 and 6–12, every way', () => {
    for (const text of [k5(), g612(), g612('exam_fde', { segmentId: G8 }), g612('past_paper', { segmentId: G10 })]) {
      expect(text).toContain(GRR_LINE);
      expect(text).toContain(ROTE_LINE);
    }
    expect(GRR_LINE).toMatch(/Keep I do, We do and You do, in that order; a way changes how a phase is taught, never removes it/);
    expect(ROTE_LINE).toMatch(/Never turn any part into rote drill: no repeat-after-me lists, copying or memorising word for word/);
  });
  it('the rote line says choral sound and word practice is allowed, so phonics is not cut', () => {
    expect(ROTE_LINE).toMatch(/Choral sound and word practice \(phonics\) is allowed and is not rote/);
  });
  it('the 1–5 rewrite system (make and change) carries both lines', () => {
    for (const lang of ['en', 'ur']) {
      expect(system(lang)).toContain(GRR_LINE);
      expect(system(lang)).toContain(ROTE_LINE);
    }
    const [sys] = k5EditMessages({ script: SCRIPT, edit: { part: 'we_do', text: 'Pairs count bottle caps' }, lang: 'en', grade: 1 });
    expect(sys.content).toContain(ROTE_LINE);
  });
  it('a 6–12 change carries both lines', () => {
    const s = buildEditInstruction({ part: 'activity', text: 'Use a role play with four groups' });
    expect(s).toContain(GRR_LINE);
    expect(s).toContain(ROTE_LINE);
  });
  it('book text (spec item 13): fed to the 6–12 instruction and the 1–5 rewrite when there is some, absent otherwise', () => {
    const ctx = { segmentId: G7, bookText: '=== Page 42 ===\nPressure is force per area.' };
    const text = buildOwnInstruction(parseOwnAnswers({ ...base, way: 'worked' }, ctx).answers, ctx);
    expect(text).toMatch(/From her book/);
    expect(text).toContain('Pressure is force per area.');
    expect(g612()).not.toMatch(/From her book/);
    const answers = parseOwnAnswers({ ...base, way: 'tarl' }).answers;
    const [, user] = k5Messages({ script: SCRIPT, answers, lang: 'en', grade: 1, subject: 'Maths', bookText: '=== Page 3 ===\nOne, two.' });
    expect(user.content).toMatch(/From her book[\s\S]*One, two\./);
    const [, plain] = k5Messages({ script: SCRIPT, answers, lang: 'en', grade: 1, subject: 'Maths' });
    expect(plain.content).not.toMatch(/From her book/);
  });
});

describe('change guard (spec item 11)', () => {
  const ROOT = { id: 'root', parent_own_id: null, status: 'ready' };
  const ask = (over) => G.checkChange({ band: 'k5', part: 'we_do', chain: [ROOT], todayCount: 0, ...over });

  it('6–12 no longer takes the whole plan; sections still work', () => {
    expect(ask({ band: 'g612', part: 'whole', text: 'Make it suit a class of 70 with no board' }).outcome).toBe('bad_request');
    expect(ask({ band: 'g612', part: 'activity', text: 'Make it suit a class of 70 with no board' }).ok).toBe(true);
  });
  it.each([
    'Skip We do, there is no time for it',
    'Please remove the You do part completely',
    'Merge we do and you do into one activity',
    'Teach it without the I do, go straight to practice',
    'you do ko hata dein, waqt nahi hai',
    'ہم کریں کو ہٹا دیں، وقت کم ہے',
  ])('refuses dropping a phase: %s', (text) => {
    expect(ask({ text }).outcome).toBe('grr');
  });
  it.each([
    'Make them memorise the definitions word for word',
    'Children repeat the poem 10 times',
    'Copy the answers from the board into notebooks',
    'bachon ko ratta lagwa dein is page ka',
    'بچوں کو یہ زبانی یاد کروائیں',
    'They should learn the answers by heart for the test',
    'Make them repeat the definitions five times each',
  ])('refuses rote drill: %s', (text) => {
    expect(ask({ text }).outcome).toBe('rote');
  });
  it.each([
    'In We do, remove the second example and add a game',
    'Do not make them memorise, use a game with stones instead',
    'Don\'t skip We do, make it a pair game with caps',
    'Make the we do a group game with stones and sticks',
    'Have the children repeat the sound b three times after me',
    'Children say the new word aloud and repeat it two times',
    'Explain how to memorise less and understand more',
    'Learn the poem by heart is not needed, explain meaning',
  ])('lets through a real change: %s', (text) => {
    expect(ask({ text }).ok).toBe(true);
  });
  it('a refusal for grr or rote never counts: it comes before the daily limit', () => {
    expect(ask({ text: 'Skip We do, there is no time for it', todayCount: 99 }).outcome).toBe('grr');
  });
});
