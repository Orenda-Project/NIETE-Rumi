/**
 * bd-rlxkkt.1 — the debrief notes follow the coach-debrief rubric (TDD, red-first).
 *
 * The ICT HITL owner's ask (3 Nov): "update debrief notes to align with the rubric that already
 * exists for debrief feedback". Coaches are judged afterwards on 8 behaviours (observe-coach-feedback
 * RUBRIC_KEYS + rehearsal) that the notes never mention. Her prototype reshapes the ur/en notes to:
 *
 *   went well (≤2) · work on first (what you saw + the next step) · a moment to bring up ·
 *   a 6-line conversation in rubric order:
 *     1 specific praise → 2 the real moment → 3 ask, then WAIT → 4 one improvement →
 *     5 the teacher names the step (WAIT) → 6 the teacher rehearses it aloud (WAIT 3–5 s)
 *
 * The wait cues are added by code, by position, never left to the model. The Swahili prompt and
 * fallback stay byte-identical (Tanzania is a live market on the 6-step script). Guides already
 * stored in the old 3+1 shape must still render (a re-send reads the stored snapshot).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const crypto = require('crypto');
const {
  buildGuidePrompt, validateGuide, renderGuideMessage, buildFallbackGuide, groundMomentTime,
  CONVERSATION_STEPS,
} = require('../../shared/services/observe/observe-debrief-guide');
const { guideFields } = require('../../shared/services/observe/observe-gender-address');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const V2 = {
  strengths: [{ evidence: 'you had every child answer in pairs' }],
  focus_area: { title: 'Checking for understanding', try_this_tomorrow: 'ask two children to explain', lever_question: 'How did you know?' },
};

// The prototype's own sample, sized as the model would write it.
const enGuide = () => ({
  intro: 'Notes for your talk with the teacher. About 10 minutes.',
  went_well: [
    'Let children work it out: in the partner activity, each child decided on their own whether a word was "farm" or "food". You didn\'t give the answer.',
    'Connected to real life: when a child brought up their own cat "Manu", you used that example to teach the concept.',
  ],
  work_on_first: {
    title: 'Asking "why"',
    seen: 'most questions were closed ("is this common or proper?") and answered in one word.',
    next_step: 'after a right answer, add one more question: "How do you know it\'s proper?"',
  },
  moment: {
    time: '17:25',
    text: 'You gave a deliberately wrong statement, "Bilal says Karachi is common because it\'s a city", and asked "what\'s confusing here?" A genuinely open question. Soon after, you went back to closed questions.',
  },
  conversation: [
    'The first thing I want to say: when the child brought up their cat \'Manu\', I really liked how you used it.',
    'There\'s a moment I\'d like to discuss, around the 17-minute mark, when you said \'Bilal says Karachi is common\'.',
    'What was going through your mind at that point?',
    'If we work on just one thing: adding a \'why\' after a child gives the right answer.',
    'Next time, once a child gives the right answer, what will you do differently?',
    'Say that question to me now, exactly as you\'ll say it to the class.',
  ],
  outro: 'No number to hand over: one true strength, one move.',
});

const urGuide = () => ({
  intro: 'استاد سے گفتگو کے نوٹس، تقریباً 10 منٹ۔',
  went_well: [
    'بچوں کو خود سیکھنے دیا: پارٹنر activity میں ہر بچہ خود سوچ کر بتا رہا تھا "فارم سے related ہے یا food سے" — آپ نے خود جواب نہیں دیا۔',
    'اصل زندگی سے جوڑا: جب ایک بچے نے اپنی بلی "Manu" کی مثال خود دی، آپ نے اسی مثال کو concept سمجھانے کے لیے استعمال کیا۔',
  ],
  work_on_first: {
    title: 'بچوں سے "کیوں" پوچھنا',
    seen: 'زیادہ تر سوال "یہ common ہے یا proper؟" جیسے تھے، جواب ایک لفظ میں آتا رہا۔',
    next_step: 'صحیح جواب کے بعد ایک اور سوال شامل کریں — "آپ کو کیسے پتہ یہ proper ہے؟"',
  },
  moment: {
    time: '17:25',
    text: 'آپ نے ایک نقلی جملہ دیا — "بلال کہتا ہے کراچی common ہے کیونکہ یہ city ہے" — اور پوچھا "اس میں کیا confusing ہے؟" بہت اچھا، کھلا سوال تھا۔ لیکن تھوڑی دیر میں بند سوال واپس آ گئے۔',
  },
  conversation: [
    'سب سے پہلے یہ بتانا ہے — جب بچے نے اپنی بلی \'Manu\' کی مثال دی، مجھے بہت اچھا لگا کہ آپ نے اسے استعمال کیا۔',
    'ایک لمحہ ہے جس پر بات کرنی ہے — 17 منٹ کے قریب، جب \'بلال کہتا ہے کراچی common ہے\' کہا گیا۔',
    'اس وقت آپ کے ذہن میں کیا چل رہا تھا؟',
    'اگر ہم صرف ایک چیز پر کام کریں — صحیح جواب کے بعد ایک \'کیوں\' شامل کرنا۔',
    'اگلی بار صحیح جواب کے بعد کیا مختلف کرنا ہے؟ اپنے الفاظ میں بتائیں۔',
    'یہ سوال ابھی مجھے کہہ کر دکھائیں، بالکل ویسے جیسے کلاس میں کہنا ہے۔',
  ],
  outro: 'استاد کو کوئی نمبر نہیں دینا — ایک سچی خوبی اور ایک قدم۔',
});

const sample = { en: enGuide, ur: urGuide };

describe('the ur/en prompt asks for the rubric-shaped notes', () => {
  for (const lang of ['ur', 'en']) {
    const p = buildGuidePrompt(V2, { language: lang });
    it(`${lang}: names the four parts and the JSON keys`, () => {
      for (const key of ['"went_well"', '"work_on_first"', '"moment"', '"conversation"']) expect(p).toContain(key);
      expect(p).not.toMatch(/"sections"/);
    });
    it(`${lang}: the conversation is six lines in rubric order, rehearsal last`, () => {
      expect(p).toMatch(/exactly 6|exactly six/i);
      const order = [/specific praise/i, /real moment/i, /ask.*wait|wait.*ask/i, /one improvement/i, /teacher names/i, /rehears/i];
      let at = -1;
      for (const rx of order) {
        const m = p.slice(at + 1).search(rx);
        expect(m).toBeGreaterThan(-1);
        at += 1 + m;
      }
    });
    it(`${lang}: talk-less and moves-not-person are rules on every line`, () => {
      expect(p).toMatch(/every line/i);
      expect(p).toMatch(/moves?, never the (teacher as a )?person|never about the (teacher as a )?person/i);
      expect(p).toMatch(/talk less|teacher (does|do) (most of )?the talking|short lines/i);
    });
    it(`${lang}: a moment's time only when the data has one`, () => {
      expect(p).toMatch(/"time"/);
      expect(p).toMatch(/never invent/i);
    });
  }

  it('the Swahili prompt and fallback are byte-identical', () => {
    const PF = { title: 'Wait time', try_this_tomorrow: 'count to five', attempt: 2, status: 'partial' };
    expect(sha(buildGuidePrompt(V2, { language: 'sw' }))).toBe('fa066e1165c0eb91f54044219d236a2c2bb330fbb1210a4bc5e6b697d3f1efc0');
    expect(sha(buildGuidePrompt(V2, { language: 'sw', previousFocus: PF }))).toBe('89bdaddff58d524a62ed86ee1d1a32650402e9ddbde80fa0f23a5cc21b302fc8');
    expect(sha(JSON.stringify(buildFallbackGuide(V2, { language: 'sw' })))).toBe('0e9fad55c17707b5a297badfeeac8a7bd8c5d7b5d8f740c0679849fc51faeae7');
  });
});

describe('the validator holds the new shape', () => {
  for (const lang of ['ur', 'en']) {
    const S = observeStrings(lang);
    it(`${lang}: accepts the prototype-sized guide, inside the budget`, () => {
      expect(validateGuide(sample[lang](), S, lang)).toBe(true);
    });
    it(`${lang}: the conversation must be exactly six lines`, () => {
      for (const n of [5, 7]) {
        const g = sample[lang]();
        g.conversation = n === 5 ? g.conversation.slice(0, 5) : [...g.conversation, 'one more'];
        expect(() => validateGuide(g, S, lang)).toThrow(/six|6/);
      }
      const g = sample[lang]();
      g.conversation[5] = '   ';
      expect(() => validateGuide(g, S, lang)).toThrow(/conversation/);
    });
    it(`${lang}: went well is one or two items, never a list of three`, () => {
      const g = sample[lang]();
      g.went_well = [...g.went_well, 'a third thing'];
      expect(() => validateGuide(g, S, lang)).toThrow(/went_well/);
      g.went_well = [];
      expect(() => validateGuide(g, S, lang)).toThrow(/went_well/);
    });
    it(`${lang}: work on first needs a title and a next step`, () => {
      const g = sample[lang]();
      delete g.work_on_first.next_step;
      expect(() => validateGuide(g, S, lang)).toThrow(/work_on_first/);
    });
    it(`${lang}: a score in a conversation line is still caught`, () => {
      const g = sample[lang]();
      g.conversation[3] = 'You got 12/20 on questioning.';
      expect(() => validateGuide(g, S, lang)).toThrow(/score/);
    });
    it(`${lang}: the old 3+1 shape is no longer accepted from the model`, () => {
      const old = { intro: 'x', sections: { strengths: { title: 'a', say_this: 'b' }, growth: { title: 'a', say_this: 'b' }, action: { title: 'a', say_this: 'b' } }, reflection_question: 'q?', outro: 'y' };
      expect(() => validateGuide(old, S, lang)).toThrow(/conversation|went_well/);
    });
  }
});

describe('the WhatsApp render', () => {
  for (const lang of ['ur', 'en']) {
    const S = observeStrings(lang);
    it(`${lang}: four parts in order, then six numbered lines`, () => {
      const g = sample[lang]();
      const out = renderGuideMessage(g, S);
      const at = [S.guide_went_well_label, S.guide_work_on_label, S.guide_moment_label, S.guide_conversation_label].map((l) => out.indexOf(l));
      at.forEach((i) => expect(i).toBeGreaterThan(-1));
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      const lines = g.conversation.map((l) => out.indexOf(l));
      lines.forEach((i, k) => { expect(i).toBeGreaterThan(at[3]); if (k) expect(i).toBeGreaterThan(lines[k - 1]); });
      for (let n = 1; n <= 6; n += 1) expect(out).toMatch(new RegExp(`(^|\\n)${n}\\. `));
    });
    it(`${lang}: wait cues come from code on lines 3, 5 and 6, nowhere else`, () => {
      const out = renderGuideMessage(sample[lang](), S);
      const rows = out.split('\n').filter((r) => /^[1-6]\. /.test(r));
      expect(rows).toHaveLength(6);
      expect(rows[2]).toContain(S.guide_cue_wait);
      expect(rows[4]).toContain(S.guide_cue_name_it);
      expect(rows[5]).toContain(S.guide_cue_rehearse);
      for (const i of [0, 1, 3]) {
        expect(rows[i]).not.toContain(S.guide_cue_wait);
        expect(rows[i]).not.toContain(S.guide_cue_rehearse);
      }
    });
    it(`${lang}: the moment shows its time only when it has one`, () => {
      const g = sample[lang]();
      expect(renderGuideMessage(g, S)).toContain('17:25');
      g.moment.time = null;
      expect(renderGuideMessage(g, S)).not.toContain('17:25');
      delete g.moment;
      expect(renderGuideMessage(g, S)).not.toContain(S.guide_moment_label);
    });
    it(`${lang}: the prototype-sized guide plus the recording instruction fits one WhatsApp message`, () => {
      const out = renderGuideMessage(sample[lang](), S);
      expect([...out].length).toBeLessThanOrEqual(2200);
      expect([...`${out}\n\n${S.debrief_record_instruction}`].length).toBeLessThanOrEqual(4096);
    });
  }

  it('a guide stored in the old 3+1 shape still renders', () => {
    const S = observeStrings('en');
    const old = {
      intro: 'Your guide.',
      sections: { strengths: { title: 'Strengths', say_this: 'I loved the pair work.' }, growth: { title: 'Areas for growth', say_this: 'How about…' }, action: { title: 'Action plan', say_this: 'Thursday?' } },
      reflection_question: 'What will you try?',
      outro: 'No number.',
    };
    const out = renderGuideMessage(old, S);
    expect(out).toContain('I loved the pair work.');
    expect(out).toContain('What will you try?');
  });

  it('the conversation steps are named in rubric order', () => {
    expect(CONVERSATION_STEPS).toEqual(['praise', 'moment', 'ask_wait', 'one_improvement', 'teacher_names', 'rehearse']);
  });
});

describe('the no-model fallback speaks the same shape', () => {
  for (const lang of ['ur', 'en']) {
    it(`${lang}: six lines, passes its own gates, inside the budget`, () => {
      const g = buildFallbackGuide(V2, { language: lang });
      expect(g.conversation).toHaveLength(6);
      expect(g.went_well.length).toBeGreaterThanOrEqual(1);
      expect(g.work_on_first.next_step).toBeTruthy();
      expect(validateGuide(g, observeStrings(lang), lang)).toBe(true);
      const empty = buildFallbackGuide({}, { language: lang });
      expect(validateGuide(empty, observeStrings(lang), lang)).toBe(true);
    });
    it(`${lang}: the last line asks the teacher to say it aloud`, () => {
      const g = buildFallbackGuide(V2, { language: lang });
      expect(g.conversation[5]).toMatch(lang === 'en' ? /say|out loud/i : /کہہ کر|زبانی/);
    });
  }
});

describe('a moment time is kept only when the data has it', () => {
  it('drops a time the observation data does not hold', () => {
    const g = enGuide();
    const out = groundMomentTime(g, { strengths: [{ evidence: 'no times here' }] });
    expect(out.moment.time).toBeNull();
    expect(out.moment.text).toBe(g.moment.text);
  });
  it('keeps a time the data holds', () => {
    const out = groundMomentTime(enGuide(), { moments: [{ minute: '17:25', quote: 'Bilal says' }] });
    expect(out.moment.time).toBe('17:25');
  });
  it('leaves other shapes alone', () => {
    const old = { sections: {}, intro: 'x' };
    expect(groundMomentTime(old, {})).toBe(old);
  });
});

describe('the gender check reads the new fields', () => {
  it('conversation lines are SAID to the teacher; the rest is written to the coach', () => {
    const fields = guideFields(urGuide());
    const by = Object.fromEntries(fields.map(([name, kind]) => [name, kind]));
    for (let i = 0; i < 6; i += 1) expect(by[`conversation.${i}`]).toBe('stem');
    expect(by['went_well.0']).toBe('feedback');
    expect(by['work_on_first.next_step']).toBe('feedback');
    expect(by['moment.text']).toBe('feedback');
  });
});
