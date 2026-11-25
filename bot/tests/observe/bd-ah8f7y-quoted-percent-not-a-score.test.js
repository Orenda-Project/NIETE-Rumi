/**
 * bd-ah8f7y — the score-leak guard refused a coach's debrief because the COACH said a percentage.
 *
 * NIETE production, 25 Nov 2026 (FICO pilot day): a coach's debrief with a teacher had the coach saying
 * "50% of the class". The coach-feedback card quoted that line back as evidence, and the guard `/\d+\s*%/`
 * (observe-coach-feedback.js SCORE_PATTERNS) refused it as "feedback leaks a score on the officer". The
 * guided repair failed too, and so did the coach's Try again (13:40, 15:11): the debrief stayed with a
 * transcript and no feedback, so no report could be made for that teacher.
 *
 * The guard is there for one thing: OUR card must never put a number, score, percentage or grade on the
 * officer (D23/D27). A figure the coach or teacher actually said in the recorded talk is a quote, not a score.
 *
 * Contract:
 *   1. a figure in the card that the transcript itself says (50%, "50 فیصد", "۵۰ فیصد", "3/4") passes;
 *   2. a figure the transcript does not say is still refused, exactly as before;
 *   3. with no transcript given, nothing changes;
 *   4. a null model answer is "feedback missing", never a TypeError on `.value` (the 15:11 repair crash);
 *   5. the debrief job hands the transcript to the guard, on the first answer and on the repair.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const RUBRIC = {
  opened_with_specific_praise: true, anchored_in_real_moment: true,
  asked_and_waited: false, one_improvement_only: true, moves_not_teacher: true,
  elicited_if_then: true, righting_reflex_held: true, rehearsed_the_step: false, disparaged_teacher: false,
};

/** A valid ur/en card whose evidence quotes the coach's own "50% of the class". */
const card = (over = {}) => ({
  praise_line: 'You opened with a real moment from the lesson.',
  wins: [
    { behaviour: 'Anchored in a real moment', evidence: 'you said "she said 50% of the class put their hands up"' },
    { behaviour: 'Let the teacher commit', evidence: 'you asked "what will you try tomorrow?"' },
  ],
  try: { move: 'Hold the silence', evidence: 'you answered your own question', instead: 'Wait three seconds.' },
  reflection_question: 'What did you notice when you waited?',
  rubric: { ...RUBRIC },
  ...over,
});

const TRANSCRIPT_EN = '[00:08] Coach: She said 50% of the class put their hands up when you asked. [00:20] Teacher: Yes, the rest were quiet.';

describe('bd-ah8f7y · validateCoachFeedback: a figure the coach said is a quote, not a score', () => {
  const F = require('../../shared/services/observe/observe-coach-feedback');

  it('passes a percentage the transcript itself says (the 25 Nov case)', () => {
    expect(F.validateCoachFeedback(card(), { rehearsal: true, transcript: TRANSCRIPT_EN })).toBe(true);
  });

  it('passes it when the coach said it in Urdu ("50 فیصد") and the card writes 50%', () => {
    const t = '[00:08] کوچ: انہوں نے کہا کہ کلاس کے 50 فیصد بچوں نے ہاتھ اٹھائے۔ استاد: جی ہاں۔';
    expect(F.validateCoachFeedback(card(), { rehearsal: true, transcript: t })).toBe(true);
  });

  it('passes it when the transcript writes the number in Urdu digits ("۵۰ فیصد")', () => {
    const t = 'کوچ: کلاس کے ۵۰ فیصد بچوں نے ہاتھ اٹھائے۔';
    expect(F.validateCoachFeedback(card(), { rehearsal: true, transcript: t })).toBe(true);
  });

  it('passes a fraction the coach said ("3/4 of the children")', () => {
    const fb = card({ try: { move: 'Hold the silence', evidence: 'you said "3/4 of the children answered"', instead: 'Wait.' } });
    const t = 'Coach: I saw 3/4 of the children answered your question. Teacher: Thank you.';
    expect(F.validateCoachFeedback(fb, { rehearsal: true, transcript: `${t} ${TRANSCRIPT_EN}` })).toBe(true);
  });

  it('still refuses a score the transcript never says (a percentage on the officer)', () => {
    const fb = card({ praise_line: 'You managed 75% of the debrief moves.' });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true, transcript: TRANSCRIPT_EN })).toThrow(/score/);
  });

  it('still refuses a fraction score the transcript never says', () => {
    const fb = card({ missed: { asked_and_waited: 'You scored 3/8 on this.' } });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true, transcript: TRANSCRIPT_EN })).toThrow(/score/);
  });

  it('a different number with the same digits is not a quote (150% vs the 50% said)', () => {
    const fb = card({ praise_line: 'You hit 150% of the target.' });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true, transcript: TRANSCRIPT_EN })).toThrow(/score/);
  });

  it('one quoted figure does not excuse a second, invented one', () => {
    const fb = card({ praise_line: 'That was 80% of a great debrief.' });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true, transcript: TRANSCRIPT_EN })).toThrow(/score/);
  });

  it('with no transcript, any percentage is refused as before', () => {
    expect(() => F.validateCoachFeedback(card(), { rehearsal: true })).toThrow(/score/);
  });

  it('a null or missing answer is "feedback missing", never a TypeError', () => {
    expect(() => F.validateCoachFeedback(null, { rehearsal: true })).toThrow('feedback missing');
    expect(() => F.validateCoachFeedback(undefined)).toThrow('feedback missing');
    expect(() => F.validateCoachFeedback('not json')).toThrow('feedback missing');
  });
});

describe('bd-ah8f7y · coachFeedbackWithRepair gives the guard the transcript', () => {
  let calls;
  beforeEach(() => { jest.resetModules(); calls = []; });
  afterEach(() => jest.resetModules());

  function loadWithLLM(results) {
    let i = 0;
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({
      completeJson: jest.fn(async (prompt, opts) => {
        calls.push({ prompt, label: opts && opts.label });
        const r = results[Math.min(i, results.length - 1)]; i += 1;
        return { result: typeof r === 'function' ? r() : r };
      }),
    }));
    return require('../../shared/services/observe/observe-debrief.service');
  }

  it('a card quoting the coach\'s 50% is accepted on the first answer, no repair', async () => {
    const D = loadWithLLM([card]);
    const out = await D.coachFeedbackWithRepair('PROMPT', 's1', { rehearsal: true, transcript: TRANSCRIPT_EN });
    expect(out.praise_line).toBe(card().praise_line);
    expect(calls.length).toBe(1);
  });

  it('a null repair answer fails as "feedback missing", not a TypeError', async () => {
    const D = loadWithLLM([card({ praise_line: '' }), null]);
    await expect(D.coachFeedbackWithRepair('PROMPT', 's1', { rehearsal: true, transcript: TRANSCRIPT_EN }))
      .rejects.toThrow('feedback missing');
  });
});

describe('bd-ah8f7y · the debrief job passes the stored transcript to the guard', () => {
  const SID = 'obs-pct-1';
  const COACH = { id: 'coach-en', phone_number: '923000000001', preferred_language: 'en' };
  const TEACHER = { id: 'teacher-en', phone_number: '923000000008', preferred_language: 'en' };
  const session = {
    id: SID,
    status: 'observer_review_complete',
    user_id: TEACHER.id,
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    debrief_status: 'pending',
    analysis_data: {
      framework: 'fico',
      observer_debrief: { audio_id: 'media-1', feedback: null, transcript: TRANSCRIPT_EN, guide_snapshot: { intro: 'x' } },
    },
    users: { name: 'Teacher Row', phone_number: TEACHER.phone_number, preferred_language: 'en' },
  };

  function db() {
    const updates = [];
    return {
      updates,
      from(table) {
        const b = { filters: {} };
        ['select', 'order', 'limit', 'in', 'not', 'or', 'is'].forEach((m) => { b[m] = () => b; });
        b.eq = (c, v) => { b.filters[c] = v; return b; };
        b.update = (f) => { updates.push(f); return b; };
        const rows = () => {
          if (table === 'coaching_sessions') return { data: session, error: null };
          if (table === 'users') {
            const [[c, v] = []] = Object.entries(b.filters);
            return { data: [COACH, TEACHER].find((u) => u[c] === v) || null, error: null };
          }
          return { data: null, error: null };
        };
        b.single = async () => rows();
        b.maybeSingle = async () => rows();
        b.then = (ok, ko) => Promise.resolve(rows()).then(ok, ko);
        return b;
      },
    };
  }

  it('the coach\'s own "50%" no longer fails the debrief: one LLM call, feedback stored', async () => {
    jest.resetModules();
    const fake = db();
    const llm = [];
    jest.doMock('../../shared/config/supabase', () => fake);
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendImageFromBuffer: jest.fn(async () => true),
      sendInteractiveButtons: jest.fn(async () => true),
      downloadMedia: jest.fn(async () => Buffer.from('fake audio data')),
    }));
    const realCard = jest.requireActual('../../shared/services/observe/observe-coach-card');
    jest.doMock('../../shared/services/observe/observe-coach-card', () => ({
      ...realCard,
      renderCoachCard: jest.fn(async () => Buffer.from('png')),
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null), setState: jest.fn(async () => true), clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-completion', () => ({
      maybeCompleteObservation: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({
      completeJson: jest.fn(async (prompt, opts) => { llm.push(opts && opts.label); return { result: card() }; }),
    }));
    const Debrief = require('../../shared/services/observe/observe-debrief.service');

    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });

    expect(llm).toEqual(['observeCoachFeedback']);   // no repair, no failure
    const merged = JSON.stringify(fake.updates);
    expect(merged).toContain('50% of the class');      // the card was stored
    expect(merged).not.toContain('feedback_failed_at');
  });
});
