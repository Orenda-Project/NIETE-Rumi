/**
 * bd-ewbzns.4.3 (queue #54, sandbox walk 7 Nov, obs a858817f) — since the 3 Nov debrief rubric the judge writes each
 * win's `behaviour` as the RUBRIC KEY ("opened_with_specific_praise"), and every place that shows the coach her own
 * feedback printed it as written: the portal's Your feedback, the WhatsApp text card and the WhatsApp image card.
 * One source of names: observe-strings coach_rubric_names (en/ur). A free-text behaviour (the older judge) is shown as
 * it was written.
 */
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Rubric = require('../../bot/shared/services/observe/observe-coach-rubric');

// The feedback the sandbox judge wrote for obs a858817f, 7 Nov (trimmed to what the cards read).
const FB = () => ({
  praise_line: 'I want to start with one thing I saw: when Zainab said "two sweets," you asked her to explain how she found it.',
  wins: [
    { behaviour: 'opened_with_specific_praise', evidence: 'I want to start with one thing I saw…' },
    { behaviour: 'asked_and_waited', evidence: 'What made you ask her to explain, instead of moving on?' },
  ],
  try: { move: 'Elicit an explicit if–then commitment.', evidence: 'You said "So what I would like you to do tomorrow is this..."', instead: 'Ask what they will try tomorrow.' },
  reflection_question: 'How might you invite the teacher to say the next step aloud?',
  concern: null,
  value: 'usikivu',
  focus: 'elicited_if_then',
  focus_why: 'Ownership.',
  rubric: {
    opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: true, one_improvement_only: false,
    moves_not_teacher: true, elicited_if_then: false, righting_reflex_held: false, rehearsed_the_step: false, disparaged_teacher: false,
  },
  did: { opened_with_specific_praise: 'You said, "That question made the whole class see the thinking."' },
  missed: { elicited_if_then: 'You offered the plan.' },
});

describe('winName — one name for a win, from observe-strings', () => {
  test.each([
    ['en', 'opened_with_specific_praise', 'Specific praise'],
    ['en', 'asked_and_waited', 'Asked & waited'],
    ['ur', 'opened_with_specific_praise', 'مخصوص تعریف'],
  ])('%s: %s → %s', (lang, key, name) => {
    expect(Rubric.winName(key, observeStrings(lang))).toBe(name);
  });

  test('a free-text behaviour (the older judge) stays as written', () => {
    expect(Rubric.winName('Asked open questions', observeStrings('en'))).toBe('Asked open questions');
  });
});

describe('the WhatsApp cards name the win, never print the key', () => {
  test.each(['en', 'ur'])('text card (%s)', (lang) => {
    const S = observeStrings(lang);
    const text = [].concat(require('../../bot/shared/services/observe/observe-coach-feedback').renderCoachFeedbackMessages(FB(), S)).join('\n');
    expect(text).not.toMatch(/opened_with_specific_praise|asked_and_waited/);
    expect(text).toContain(S.coach_rubric_names.opened_with_specific_praise);
  });

  test.each(['en', 'ur'])('image card (%s)', (lang) => {
    const html = require('../../bot/shared/services/observe/observe-coach-card').buildCoachCardHtml(FB(), { lang });
    const wins = (html.match(/<div class="wt">[^<]*<\/div>/g) || []).join(' ');
    expect(wins).not.toMatch(/opened_with_specific_praise|asked_and_waited/);
    expect(wins).toContain(observeStrings(lang).coach_rubric_names.asked_and_waited.replace('&', '&amp;'));
  });
});
