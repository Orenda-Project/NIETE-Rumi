/**
 * bd-rlxkkt.4 — fixes after the ICT HITL owner's sandbox test (4 Nov), red-first.
 *
 * Bugs:
 *  1. The report image printed ★ ☆ ✓ (and 📘 🔒 🌱) as empty boxes: the card embeds only Lexend and Noto Nastaliq,
 *     and the sandbox worker has no system font with those glyphs. Every character the image prints must now be in
 *     the embedded fonts; the stars, ticks and icons are drawn as shapes.
 *  2. The debrief notes showed key-style labels ("clear_objective:", "story_connection:"). The model copies the
 *     snake_case keys it is shown: the ur/en data block now uses plain words, the prompt forbids codes, and any
 *     key-shaped word left in the model's notes is turned into plain words before the coach sees it.
 * Changes (same card, no redesign):
 *  3. Notes line 4 names only the AREA; the teacher names the step in line 5 (the step stays above, for the coach).
 *  4. The moment to bring up: its time when the data has one, the question asked, the answer and what the teacher did.
 *  5. Report: each miss says what happened in THIS debrief (the judge's own line), then why it matters.
 *  6. Report: the next focus says "Why this one"; the coach's quote is no longer an unlabelled line in the focus box.
 *  7. Report: no Action plan box (it added a second behaviour).
 * Swahili stays byte-identical everywhere (pinned in the Phase 1 and Phase 3 suites).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const F = require('../../shared/services/observe/observe-coach-feedback');
const Card = require('../../shared/services/observe/observe-coach-card');
const G = require('../../shared/services/observe/observe-debrief-guide');
const { feedbackFields } = require('../../shared/services/observe/observe-gender-address');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const rubric = (over = {}) => {
  const r = {};
  for (const k of F.RUBRIC_KEYS) r[k] = true;
  r.disparaged_teacher = false;
  r.rehearsed_the_step = true;
  return { ...r, ...over };
};
// Rifat's sandbox report: 3/8, the focus is asked_and_waited.
const feedback = (over = {}) => ({
  praise_line: 'You opened with what really worked in the lesson.',
  wins: [
    { behaviour: 'Specific praise', evidence: 'you said "the Ta\'if story was told very well"' },
    { behaviour: 'Real moment', evidence: 'you named the moment the student said "Hazrat Umar"' },
  ],
  try: {
    move: 'Ask one open question after your praise, then wait in silence',
    evidence: 'بس ابھی جب آپ اس ویک میں نیا ڈی سی ریکارڈ کرو گے…',
    instead: 'then ask them to state the specific step in their own words',
  },
  missed: {
    asked_and_waited: 'You asked "how did it go?" and answered it yourself before the teacher spoke.',
    one_improvement_only: 'You raised feedback on answers and also the pace of the lesson.',
    elicited_if_then: 'You gave the step yourself: "name one correct piece of the answer".',
    righting_reflex_held: 'You spoke for most of the talk; the teacher\'s answers stayed short.',
    rehearsed_the_step: 'The talk ended once the plan was agreed; the teacher never said it aloud.',
  },
  focus_why: 'The other steps build on it: the teacher has to speak before they can name a step.',
  reflection_question: 'What made you move on before the teacher spoke?',
  value: 'ukuaji',
  concern: null,
  focus: 'asked_and_waited',
  rubric: rubric({
    asked_and_waited: false, one_improvement_only: false, elicited_if_then: false,
    righting_reflex_held: false, rehearsed_the_step: false,
  }),
  ...over,
});

// ── 1. the image draws only what its embedded fonts hold ─────────────────

const FONT_DIR = path.join(__dirname, '../../shared/fonts');   // where observe-coach-card.js embeds them from
const fonts = ['Lexend-Regular.ttf', 'Lexend-Bold.ttf', 'NotoNastaliqUrdu-Regular.ttf', 'NotoNastaliqUrdu-Bold.ttf']
  .map((f) => fontkit.create(fs.readFileSync(path.join(FONT_DIR, f))));
const covered = (cp) => fonts.some((font) => font.hasGlyphForCodePoint(cp));
const unentity = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// What the page prints: the body's text, without styles, markup or inline SVG (shapes need no font).
const printedText = (html) => unentity(html
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<[^>]+>/g, ' '));
const uncovered = (html) => [...new Set([...printedText(html)].filter((ch) => !/\s/.test(ch) && !covered(ch.codePointAt(0))))];

describe('1. the report image prints only glyphs its embedded fonts have', () => {
  for (const lang of ['en', 'ur']) {
    it(`${lang}: every printed character is in Lexend or Noto Nastaliq (the sandbox worker has no other font)`, () => {
      expect(uncovered(Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' }))).toEqual([]);
    });
    it(`${lang}: stars and ticks are drawn as shapes, one star per mark`, () => {
      const html = Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' });
      expect(html.match(/data-star="on"/g)).toHaveLength(3);
      expect(html.match(/data-star="off"/g)).toHaveLength(5);
      expect(html).toContain('3/8');
      expect(printedText(html)).not.toMatch(/[★☆✓✔📘🔒🌱]/u);
    });
    it(`${lang}: an emoji the model writes does not become a box either`, () => {
      const fb = feedback({ praise_line: 'Great opening 👏 well done', reflection_question: 'Why? 🤔' });
      expect(uncovered(Card.buildCoachCardHtml(fb, { lang, brand: 'niete' }))).toEqual([]);
    });
  }
});

// ── 5–7. the report's content ─────────────────────────────────────────────

describe('5–7. each miss says what happened; one focus with its reason; no Action plan', () => {
  for (const lang of ['en', 'ur']) {
    const S = observeStrings(lang);
    const text = () => F.renderCoachFeedbackMessages(feedback(), S)[1];
    const html = () => printedText(Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' }));
    for (const [surface, get] of [['text', text], ['image', html]]) {
      it(`${lang} ${surface}: every miss has its own "what happened", then why it matters`, () => {
        const c = get();
        for (const [k, line] of Object.entries(feedback().missed)) {
          const iName = c.indexOf(S.coach_rubric_names[k], c.indexOf(S.coach_card_missed_label));
          const iWhat = c.indexOf(line);
          const iWhy = c.indexOf(S.coach_rubric_why[k]);
          expect(iName).toBeGreaterThan(-1);
          expect(iWhat).toBeGreaterThan(iName);
          expect(iWhy).toBeGreaterThan(iWhat);
        }
        expect(c).toContain(S.coach_card_what_happened_label);
      });
      it(`${lang} ${surface}: the focus says why this one, and carries no second behaviour`, () => {
        const c = get();
        const iFocus = c.indexOf(S.coach_card_try_label, c.indexOf(S.coach_card_missed_label));
        expect(c.indexOf(S.coach_card_focus_why_label)).toBeGreaterThan(iFocus);
        expect(c).toContain(feedback().focus_why);
        expect(c).not.toContain(S.coach_card_action_label);
        expect(c).not.toContain('state the specific step in their own words');
        expect(c).not.toContain(feedback().try.evidence);      // the unlabelled, cut-off quote is gone
      });
    }
    it(`${lang}: an older card without the judge's lines still reads — the why line, and the coach's own words under the focus miss, labelled`, () => {
      const fb = feedback();
      delete fb.missed;
      delete fb.focus_why;
      for (const c of [F.renderCoachFeedbackMessages(fb, S)[1], printedText(Card.buildCoachCardHtml(fb, { lang, brand: 'niete' }))]) {
        expect(c).toContain(S.coach_rubric_why.rehearsed_the_step);
        const iSaid = c.indexOf(S.coach_card_you_said_label);
        expect(iSaid).toBeGreaterThan(c.indexOf(S.coach_rubric_names.asked_and_waited, c.indexOf(S.coach_card_missed_label)));
        expect(c.indexOf(fb.try.evidence)).toBeGreaterThan(iSaid);
        expect(c).not.toContain(S.coach_card_focus_why_label);
      }
    });
  }
});

describe('5–6. the ur/en judge writes the per-miss lines and the reason', () => {
  for (const lang of ['ur', 'en']) {
    it(`${lang}: the prompt asks for "missed" (what happened in THIS debrief, per false key) and "focus_why"`, () => {
      const p = F.buildCoachFeedbackPromptI18n('t'.repeat(200), {}, lang);
      expect(p).toMatch(/"missed"/);
      expect(p).toMatch(/"focus_why"/);
      expect(p).toMatch(/THIS debrief/);
      expect(p).toMatch(/never a definition|not a definition/i);
    });
  }
  it('the validator keeps only lines for behaviours judged false, as plain short strings', () => {
    const fb = feedback({
      missed: {
        asked_and_waited: '  You answered your own question.  ',
        opened_with_specific_praise: 'judged true, so this goes',
        rehearsed_the_step: 42,
        elicited_if_then: 'x'.repeat(400),
        not_a_key: 'goes',
      },
    });
    F.validateCoachFeedback(fb, { rehearsal: true });
    expect(fb.missed).toEqual({ asked_and_waited: 'You answered your own question.' });
  });
  it('a too-long or non-string reason is dropped, never shown cut off', () => {
    const a = feedback({ focus_why: 'y'.repeat(400) });
    F.validateCoachFeedback(a, { rehearsal: true });
    expect(a.focus_why).toBeNull();
    const b = feedback({ focus_why: { no: 1 } });
    F.validateCoachFeedback(b, { rehearsal: true });
    expect(b.focus_why).toBeNull();
  });
  it('a score inside a per-miss line is still caught', () => {
    const fb = feedback({ missed: { asked_and_waited: 'You scored 3/8 on this.' } });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true })).toThrow(/score/);
  });
  it('the gender check reads the new lines', () => {
    const names = feedbackFields(feedback()).map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining(['missed.asked_and_waited', 'focus_why']));
  });
});

// ── 2–4. the debrief notes ────────────────────────────────────────────────

const V2 = {
  framework: 'fico',
  strengths: [{ title: 'Clear objectives and coherent sequence', evidence: 'the aim was stated (03:34)' }],
  focus_area: { title: 'Feedback on answers', try_this_tomorrow: 'thank, correct kindly, ask for a reason', lever_question: 'What were you hoping for?' },
  domains: { student_engagement: { indicators: [{ id: 'D1', name: 'Diversity of expression', evidence: 'a student said "Hazrat Umar" [12:05]' }] } },
};

describe('2. no code names reach the coach', () => {
  for (const lang of ['ur', 'en']) {
    it(`${lang}: the data the model reads has plain-word keys, and the prompt forbids codes`, () => {
      const p = G.buildGuidePrompt(V2, { language: lang });
      const data = p.slice(p.indexOf('OBSERVATION DATA'));
      expect(data).not.toMatch(/\b[a-z]+_[a-z_]+\b/);          // no student_engagement, focus_area, try_this_tomorrow…
      expect(data).toContain('Clear objectives and coherent sequence');
      expect(p).toMatch(/never a code|no codes?|underscore/i);
    });
  }
  it('key-shaped words left in the model\'s notes become plain words', () => {
    const g = {
      intro: 'Notes.',
      went_well: ['clear_objective: the teacher stated the aim', 'story_connection: linked the story to daily life'],
      work_on_first: { title: 'feedback_on_answers', seen: 'one word answers', next_step: 'thank, correct, ask why' },
      moment: { time: null, text: 'the student said "Hazrat Umar"' },
      conversation: ['a', 'b', 'c', 'If we work on one thing: feedback_on_answers.', 'e', 'f'],
      outro: 'o',
    };
    const out = G.plainCodeNames(g);
    expect(out.went_well).toEqual(['Clear objective: the teacher stated the aim', 'Story connection: linked the story to daily life']);
    expect(out.work_on_first.title).toBe('Feedback on answers');
    expect(out.conversation[3]).toBe('If we work on one thing: feedback on answers.');
    // What the coach reads (the values, not our JSON contract's own keys).
    const read = [out.intro, out.outro, ...out.went_well, ...Object.values(out.work_on_first), out.moment.text, ...out.conversation].join('\n');
    expect(read).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });
  it('other guide shapes pass through untouched', () => {
    const old = { sections: { strengths: { title: 'a_b', say_this: 'x' } } };
    expect(G.plainCodeNames(old)).toBe(old);
  });
});

describe('3–4. line 4 names the area; the moment has its context', () => {
  for (const lang of ['ur', 'en']) {
    const p = G.buildGuidePrompt(V2, { language: lang });
    it(`${lang}: line 4 names only the area, never the step; the teacher names it in line 5`, () => {
      expect(p).toMatch(/only the AREA/);
      expect(p).toMatch(/never the step/i);
    });
    it(`${lang}: the moment gives the question asked, the answer and what the teacher did, and the step fits it`, () => {
      expect(p).toMatch(/question asked/i);
      expect(p).toMatch(/answer/i);
      expect(p).toMatch(/what the teacher did/i);
      expect(p).toMatch(/wrong.*correct it kindly/i);
    });
    it(`${lang}: the next step is labelled for the coach, not to say`, () => {
      expect(observeStrings(lang).guide_next_label).toMatch(lang === 'en' ? /not to say/ : /کہنے کے لیے نہیں/);
    });
    it(`${lang}: the no-model fallback's line 4 names the area, not the step`, () => {
      const g = G.buildFallbackGuide(V2, { language: lang });
      expect(g.conversation[3]).toContain('Feedback on answers');
      expect(g.conversation[3]).not.toContain('correct kindly');
    });
  }
});
