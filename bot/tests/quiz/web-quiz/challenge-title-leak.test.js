'use strict';
/**
 * The title gate (ITEMS §1 row 87): a passage's child-facing title never contains an accepted answer
 * of its own passage's questions. On a LISTEN stop the child sees the title before hearing the story, so a leaking
 * title gives the answer away; on a READ stop the text is on screen, so a leaking title is a named, shrinking gap
 * (READ_STOP_ALLOWLIST, each with its reason) — never a listening one. Pure: the passage files and the v3 bank on disk.
 */
const fs = require('fs');
const path = require('path');

const PASSAGES = path.join(__dirname, '../../../shared/data/child-test/passages');
const V3 = require('../../../shared/data/child-test/item-bank.v3.json');

// read-stop titles that hold an accepted answer today: the text is on screen, so the gap is named, not blocking
const READ_STOP_ALLOWLIST = {
  'en.read.1.ref01': 'read stop: text on screen',
  'en.read.1.reserve01': 'read stop: text on screen',
  'en.read.1.story01': 'read stop: text on screen',
  'en.read.1.story02': 'read stop: text on screen',
  'en.read.2.prov01': 'read stop: text on screen',
  'en.read.2.story01': 'read stop: text on screen',
  'en.read.3.prov01': 'read stop: text on screen',
  'en.read.3.ref01': 'read stop: text on screen',
  'en.read.3.story01': 'read stop: text on screen',
  'en.read.3.story02': 'read stop: text on screen',
  'ur.read.1.ref01': 'read stop: text on screen',
  'ur.read.1.reserve01': 'read stop: text on screen',
  'ur.read.1.sparrow': 'read stop: text on screen',
  'ur.read.1.story01': 'read stop: text on screen',
  'ur.read.1.story02': 'read stop: text on screen',
  'ur.read.1.story03': 'read stop: text on screen',
  'ur.read.2.prov01': 'read stop: text on screen',
  'ur.read.2.story01': 'read stop: text on screen',
  'ur.read.2.story03': 'read stop: text on screen',
  'ur.read.3.prov01': 'read stop: text on screen',
  'ur.read.3.ref01': 'read stop: text on screen',
  'ur.read.3.story01': 'read stop: text on screen',
  'ur.read.3.story02': 'read stop: text on screen',
  'ur.read.3.story03': 'read stop: text on screen',
};

// practice-pool LISTENING stories (Story Time, 'just for fun') whose title holds an answer: a named, shrinking gap for the copy
// owner's native re-title (the five counted listening stories are re-titled already; these are not counted). Never a check-pool passage.
const PRACTICE_LISTEN_ALLOWLIST = {
  'en.listen.1.story01': 'practice listen: Story Time, re-title owed',
  'ur.listen.1.story01': 'practice listen: Story Time, re-title owed',
  'ur.listen.2.story01': 'practice listen: Story Time, re-title owed',
  'ur.listen.3.story01': 'practice listen: Story Time, re-title owed',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْٰ]/g, '').replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
const containsWord = (title, answer) => {
  const t = ` ${norm(title)} `; const a = norm(answer);
  return a.length > 0 && t.includes(` ${a} `);
};
const answersOf = (q) => [...(q.accept || []), ...(q.right ? [q.right] : [])];

function questionsFor(p) {
  const qs = [...(p.questions || []), ...(p.questions_extra || [])];
  if (p.v3_ref) {
    const v3 = V3.sets.A.reading[p.v3_ref.lang][p.v3_ref.kind];
    qs.push(...((v3 && v3.questions) || []));
  }
  return qs;
}

function leaksOf(p) {
  const out = [];
  for (const field of ['title_en', 'title_ur']) {
    const title = p[field];
    if (!title) continue;
    for (const q of questionsFor(p)) for (const a of answersOf(q)) if (containsWord(title, a)) out.push({ passage_id: p.passage_id, kind: p.kind, pool: p.pool, field, answer: a, q: q.id });
  }
  return out;
}

const files = () => fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8')));

describe('the title gate: no title contains an accepted answer of its own passage\'s questions', () => {
  test('no COUNTED listen passage title leaks an answer (the child hears the story after seeing the title); a practice story that leaks is named', () => {
    const leaks = files().filter((p) => p.kind === 'listen').flatMap(leaksOf);
    expect(leaks.filter((l) => l.pool === 'check')).toEqual([]);
    const practice = [...new Set(leaks.filter((l) => l.pool !== 'check').map((l) => l.passage_id))].sort();
    expect(practice.filter((id) => !PRACTICE_LISTEN_ALLOWLIST[id])).toEqual([]);
    expect(Object.keys(PRACTICE_LISTEN_ALLOWLIST).filter((id) => !practice.includes(id))).toEqual([]);
  });
  test('every READ passage title that leaks is on the allowlist with its reason; the allowlist names only real leaks', () => {
    const leaks = files().filter((p) => p.kind === 'read').flatMap(leaksOf);
    const leaking = [...new Set(leaks.map((l) => l.passage_id))].sort();
    const unlisted = leaking.filter((id) => !READ_STOP_ALLOWLIST[id]);
    expect(unlisted.map((id) => `${id}: ${leaks.filter((l) => l.passage_id === id).map((l) => `${l.field} ∋ "${l.answer}" (${l.q})`).join('; ')}`)).toEqual([]);
    const stale = Object.keys(READ_STOP_ALLOWLIST).filter((id) => !leaking.includes(id));
    expect(stale).toEqual([]);
    for (const [id, why] of Object.entries(READ_STOP_ALLOWLIST)) expect(why).toMatch(/^read stop: /);
  });
  test('the eight re-titled passages carry their titles on the files, byte for byte', () => {
    const by = Object.fromEntries(files().map((p) => [p.passage_id, p]));
    expect(by['en.read.2.setA']).toMatchObject({ title_en: "Imran's Busy Morning", title_ur: 'عمران کی مصروف صبح' });
    expect(by['ur.read.2.setA']).toMatchObject({ title_en: "Bilal's Day", title_ur: 'بلال کا دن' });
    expect(by['en.listen.2.setA']).toMatchObject({ title_en: 'Sara Goes to the Shop', title_ur: 'سارہ دکان پر گئی' });
    expect(by['ur.listen.2.setA']).toMatchObject({ title_en: "Ayesha's School", title_ur: 'عائشہ کا اسکول' });
    expect(by['en.listen.1.ref01'].title_en).toBe('Fahad Helps Out');
    expect(by['en.listen.3.ref01'].title_en).toBe("Usman's Big Idea");
    expect(by['ur.listen.1.ref01'].title_ur).toBe('فہد کی تلاش');
    expect(by['ur.listen.3.ref01'].title_ur).toBe('رانیہ بازار میں');
  });
  test('the gate itself: a title holding an accepted answer is caught, as a whole word, in either language', () => {
    const p = { passage_id: 'xx.listen.1.t', kind: 'listen', title_en: 'The Lost Dog', title_ur: 'سفید مرغی', questions: [{ id: 'q1', accept: ['a dog', 'dog'] }, { id: 'q2', accept: ['مرغی'] }] };
    expect(leaksOf(p).map((l) => l.answer)).toEqual(['dog', 'مرغی']);
    expect(leaksOf({ ...p, title_en: 'Fahad Helps Out', title_ur: 'فہد کی تلاش' })).toEqual([]);
    expect(leaksOf({ ...p, title_en: 'Dogged', title_ur: null })).toEqual([]);   // a word, not a substring
  });
});
