/**
 * From the SECOND live call (2026-08-24, +92 322 2482222). The context was
 * delivered perfectly — coaching:true, lessons:true, 0 failures, 11,796 chars —
 * and she STILL told the caller she had no records. Four separate causes, none
 * of them a missing-data problem:
 *
 *  A. The no-measurement rule read as "I don't have this." Asked why his numbers
 *     were low she said: "اگر آپ کی coaching history میں کسی نمبر کا ذکر ہے تو اسے
 *     میں دیکھ نہیں سکتی۔ ابھی تک کچھ بھی ایسا record نہیں ہے میرے پاس۔"
 *     A rule meant to stop UNSOLICITED judgment became a denial of the record.
 *  B. Scores were withheld from the context entirely, so even when he ASKED she
 *     had nothing to answer with.
 *  C. Truncation markers leaked into speech — twice she told him his record was
 *     "truncation کی وجہ سے" incomplete. Internal plumbing, narrated aloud.
 *  D. She introduced herself as "میرا نام… ہے" — "my name is …" — because the
 *     prompt told her to give her name without ever stating it.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');
const { buildCallContext } = require('../../shared/calls/call-context.service');

const ANALYSIS = {
  executive_summary: 'Clear steps and strong maths content knowledge.',
  focus_area: { title: 'اختتامی خلاصہ', try_this_tomorrow: 'دو طلبہ سے پوچھیں' },
  strengths: [{ title: 'Lesson Plan Fidelity' }],
  recommendations: ['Ask two pupils to summarise.'],
  scores: { overall_percentage: 68 },
};
const deps = (over = {}) => ({
  fetchUser: async () => ({ id: 'u-1', first_name: 'Haroon', preferred_language: 'ur', role: 'coach' }),
  fetchLatestCoaching: async () => ({ completed_at: '2026-08-20T09:00:00Z', analysis_data: ANALYSIS }),
  fetchLpContext: async () => 'L'.repeat(9000),
  fetchUpcomingVisit: async () => null,
  fetchTraining: async () => null,
  fetchMemory: async () => null,
  fetchObservedSessions: async () => ([
    { teacherName: 'Fatima', schoolName: 'GGPS Rawal', when: '2026-08-19T09:00:00Z', focus: 'Wait time' },
  ]),
  now: () => new Date('2026-08-24T12:00:00Z'),
  ...over,
});

describe('A+B — she HAS the record, and answers when asked', () => {
  test('the prompt states plainly that she HAS the coaching record', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/you (do )?have .{0,60}(coaching|record)/i);
  });

  test('the prompt tells her to ANSWER a direct question about a score', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/if she asks .{0,80}(score|number|why)/i);
    expect(p).toMatch(/answer/i);
  });

  test('the prompt never lets "do not volunteer" become "I cannot see"', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/never say you (cannot|can't) see|not a denial|do not deny/i);
  });

  test('the score IS in the context, flagged as answer-only-if-asked', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/68/);
    expect(block).toMatch(/only if she asks|if she asks/i);
  });

  test('the context does not instruct her to deny having a score', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).not.toMatch(/do not volunteer any score\.$/im);
  });
});

describe('C — truncation is silent, never narrated', () => {
  test('no truncation marker ever reaches the prompt', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).not.toMatch(/truncat/i);
    expect(block).not.toMatch(/…\s*\(/);
  });

  test('a large context is still admitted rather than cut to the bone', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block.length).toBeGreaterThan(6000);
  });

  test('an absurd payload is still bounded', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchLpContext: async () => 'x'.repeat(500000) }),
    });
    expect(block.length).toBeLessThanOrEqual(14000);
    expect(block).not.toMatch(/truncat/i);
  });
});

describe('D — she has a name and uses it', () => {
  test('the prompt states the name instead of asking her to supply one', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/NIETE Teaching Assistant/);
    expect(p).not.toMatch(/your name,/i); // the phrasing that produced "my name is …"
  });
});

describe('E — a coach can ask about the teachers SHE observed', () => {
  test('sessions she observed appear in the context', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/OBSERVED|observations she has done/i);
    expect(block).toContain('Fatima');
    expect(block).toContain('GGPS Rawal');
  });

  test('a caller who has observed nobody gets no such block', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchObservedSessions: async () => [] }),
    });
    expect(block).not.toMatch(/## TEACHERS SHE HAS OBSERVED/);
  });

  test('an observer-lookup failure never breaks the call', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchObservedSessions: async () => { throw new Error('down'); } }),
    });
    expect(block).toContain('Haroon');
  });

  test('the role is stated so she frames the conversation correctly', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/coach/i);
  });
});
