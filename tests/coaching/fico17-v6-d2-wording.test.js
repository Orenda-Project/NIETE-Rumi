'use strict';
/**
 * bd-ra8xu.61 — FICO17 v6 D2 "How many children spoke" in words, not counts. Operator, 13 Nov: "the options are off.
 * The 6+ and 2+ is way too specific". Approved wording (option A, 19 Nov): how much of the class spoke — a few
 * children, many but a large part of the class never, most of the class — and chorus answers do not count.
 *
 * Pinned here, through the code coaches' screens are built from:
 *   - the rubric data (fico17_v6.rubric.json) carries option A's English, with no number in any D2 text;
 *   - the coach's D2 choices, English and Urdu, are the level names with that text (WhatsApp and portal share them);
 *   - the old count rule is gone: a level the counts would not give is no longer refused, on /observe or /observe2,
 *     while counts an old form still sends are still checked for sense and still stored;
 *   - the Digital Coach is untouched: it is never asked about D2 and still counts student turns per half.
 */
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

const EN = {
  definition: 'How much of the class speaks during the lesson: a few children, many, or most of the class. A child counts when they speak on their own (answer, read out, ask a question); chorus answers do not count.',
  levels: [
    'No student speaks during the lesson.',
    'Only a few children speak.',
    'Many children speak, but a large part of the class never does.',
    'Most of the class speaks at least once.',
  ],
  coach_adds: 'how much of the class spoke on their own. The coach sets the final level with a written justification.',
  combined_evidence: 'The DC reports the number of student turns, split into the first and second half of the lesson. It does not give a level, because the transcript cannot tell children apart.',
};

const UR = {
  definition: 'سبق کے دوران جماعت کا کتنا حصہ بولتا ہے: چند بچے، کئی بچے، یا جماعت کے زیادہ تر بچے۔ وہ بچہ شمار ہوتا ہے جو اکیلے بولے (جواب دے، پڑھ کر سنائے، سوال پوچھے)؛ سب بچوں کا مل کر ایک ساتھ جواب دینا شمار نہیں ہوتا۔',
  levels: [
    'سبق کے دوران کوئی طالب علم نہیں بولتا۔',
    'صرف چند بچے بولتے ہیں۔',
    'کئی بچے بولتے ہیں، لیکن جماعت کا بڑا حصہ پورے سبق میں نہیں بولتا۔',
    'جماعت کے زیادہ تر بچے کم از کم ایک بار بولتے ہیں۔',
  ],
  coach_adds: 'جماعت کا کتنا حصہ اکیلے بولا۔ کوچ تحریری وجہ کے ساتھ آخری لیول طے کرتا ہے۔',
};

// Any digit (Latin, Arabic-Indic, Extended Arabic-Indic) or a count word from the old levels.
const NUMBER_RX = /[0-9٠-٩۰-۹]|\b(one|two|three|five|six)\b|\+|ایک یا دو|تین سے پانچ|چھ یا زیادہ|کم از کم دو/i;

describe('D2 in the rubric data: option A, no numbers', () => {
  const d2 = v6.indicator('D2');

  test('definition, the four levels, what the coach adds and what the DC reports are option A, word for word', () => {
    expect(d2.name).toBe('How many children spoke');
    expect(d2.kind).toBe('combined');
    expect(d2.definition).toBe(EN.definition);
    expect(d2.levels.map((l) => l.text)).toEqual(EN.levels);
    expect(d2.coach_adds).toBe(EN.coach_adds);
    expect(d2.combined_evidence).toBe(EN.combined_evidence);
  });

  test('no D2 text counts children: definition, levels, examples, what the coach adds', () => {
    const texts = [d2.definition, d2.coach_adds, ...d2.levels.map((l) => l.text), ...d2.levels.map((l) => l.example).filter(Boolean)];
    for (const t of texts) expect(t).not.toMatch(NUMBER_RX);
  });

  test('the short titles have no numbers and fit WhatsApp\'s 30 code points', () => {
    expect(v6.TITLES.D2).toEqual(['No child spoke', 'Only a few children', 'Many, not most of the class', 'Most of the class']);
    for (const t of v6.TITLES.D2) {
      expect(t).not.toMatch(NUMBER_RX);
      expect(v6.cp(t)).toBeLessThanOrEqual(30);
    }
  });

  test('the Urdu is option A\'s, still a draft for review', () => {
    const t = v6.indicatorText('D2', 'ur');
    expect(t.definition).toBe(UR.definition);
    expect(t.levels).toEqual(UR.levels);
    expect(t.coach_adds).toBe(UR.coach_adds);
    expect(v6.URDU.status).toBe('draft');
    for (const s of [t.definition, t.coach_adds, ...t.levels]) expect(s).not.toMatch(NUMBER_RX);
  });
});

describe('what a coach chooses from for D2 (WhatsApp and portal)', () => {
  test.each([
    ['en', EN.levels, ['Not Observed', 'Developing', 'Proficient', 'Highly Effective']],
    ['ur', UR.levels, ['مشاہدے میں نہیں آیا', 'ترقی پذیر', 'ماہر', 'انتہائی مؤثر']],
  ])('%s: the level names with option A\'s text, no numbers', (lang, texts, names) => {
    const opts = v6.coachLevelOptions('D2', lang);
    expect(opts).toEqual(texts.map((description, i) => ({ id: String(i + 1), title: names[i], description })));
    for (const o of opts) expect(o.description).not.toMatch(NUMBER_RX);
  });

  test.each(['en', 'ur'])('%s: the /observe review screen serves the same choices', (lang) => {
    expect(O6.optionsFor('D2', { lang }).map((o) => o.description)).toEqual(lang === 'ur' ? UR.levels : EN.levels);
  });
});

describe('the old count rule is gone (an old form may still send counts)', () => {
  const ok = { r_D1: '1', r_D5: '1', r_D3: 'NA', why_D3: 'No child spoke to another child.', r_D4: '2', why_D4: 'They only answered when they were sure.' };

  test('a level the counts would not have given is accepted with a reason in words', () => {
    // Old rule: 4 children, none quiet-then-spoke → level 3, so 4 needed a number in the reason.
    const data = { ...ok, d2_children: '4', d2_quiet_later: '0', r_D2: '4', why_D2: 'Most of the class answered, back rows too.' };
    expect(O6.validateScreen('DOMAIN_D', data, {})).toEqual({});
  });

  test('counts that make no sense are still refused, and sensible ones are still stored', () => {
    expect(O6.validateScreen('DOMAIN_D', { ...ok, d2_children: '3', d2_quiet_later: '5', r_D2: '3', why_D2: 'Front rows only answered today.' }, {}).d2_children).toBeTruthy();
    const review = O6.buildReview({}, { ...ok, d2_children: '4', d2_quiet_later: '0', r_D2: '4', why_D2: 'Most of the class answered, back rows too.' });
    expect(review.d2_counts).toEqual({ children: 4, quiet_later: 0 });
    expect(review.levels.D2).toMatchObject({ level: 4, set_by: 'coach', because: 'Most of the class answered, back rows too.' });
  });

  test('no "level doesn\'t match the counts" message is left, in English or Urdu, on /observe or /observe2', () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
    for (const lang of ['en', 'ur']) {
      expect(observeStrings(lang)).not.toHaveProperty('v6_d2_mismatch');
      expect(observe2Strings(lang)).not.toHaveProperty('v6_d2_mismatch');
      expect(O6.messages(lang)).not.toHaveProperty('v6_d2_mismatch');
    }
    expect(O6).not.toHaveProperty('d2Expected');
  });
});

describe('the Digital Coach is untouched', () => {
  test('it still counts student turns per half for D2, from the transcript', () => {
    const t = ['[00:10] Teacher (EN): Who knows?', '[00:20] Student (EN): Me!', '[05:00] Student (EN): Twelve.', '[09:00] Student (EN): Because.', '[10:00] Teacher (EN): Good.'].join('\n');
    expect(fw.countD2(t)).toEqual({ student_turns_first_half: 2, student_turns_second_half: 1 });
  });

  test('its prompt never carries D2\'s words, old or new', () => {
    const p = `${fw.getSystemPrompt()}\n${fw.buildAnalysisPrompt('[00:10] Teacher (EN): Who knows?', { grade: 4 })}`;
    for (const text of [...EN.levels.slice(1), EN.definition, 'Three to five different children speak.']) expect(p).not.toContain(text);
    expect(p).toContain('(How many children spoke is counted separately; do not report it.)'); // its one D2 line, unchanged
  });
});
