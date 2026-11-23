/**
 * bd-s192t.12 — a lesson recording the transcriber never split into teacher vs children.
 *
 * Eval #230 (NIETE prod read replica, 7 Sep-23 Nov): 1,380 of 26,145 lesson recordings of 5+ minutes (5.3%, flat every
 * week) came back with one speaker label (710) or with labels but under one speaker turn a minute (657). Every line then
 * reads "Teacher:", the FICO scorer finds no "Student:" line and scores the children's indicators as absent: the same
 * teacher's unsplit lessons score 3.4 points lower (2.8-4.1) than her split ones.
 *
 *   T1  speakerSplit names a one-voice and a few-turns recording as unsplit, a normal one as split
 *   T2  too short, or no diarization at all → null (not judged)
 *   T3  speakerSplitFor reads the switch: off (default) → null, so the prompt stays byte-identical
 *   T4  the FICO prompt carries the unsplit note before the transcript only when told the recording is unsplit
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { speakerSplit, speakerSplitFor } = require('../../bot/shared/services/coaching/speaker-split');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const seg = (label, i) => ({ speaker: label === 'Teacher' ? '1' : '2', label, text: 'x', start_ms: i * 1000, end_ms: i * 1000 + 900 });
const alternating = (n) => ({ segments: Array.from({ length: n }, (_, i) => seg(i % 2 ? 'Student' : 'Teacher', i)) });

describe('bd-s192t.12 — unsplit lesson recordings', () => {
  test('T1: one voice and few turns are unsplit; a normal recording is split', () => {
    expect(speakerSplit({ segments: [seg('Teacher', 0)] }, 1200)).toMatchObject({ split: false, reason: 'one_voice' });
    expect(speakerSplit(alternating(10), 1200)).toMatchObject({ split: false, reason: 'few_turns' });   // 10 turns in 20 min
    expect(speakerSplit(alternating(400), 1200)).toMatchObject({ split: true, reason: null });         // 20 a minute
    expect(speakerSplit(alternating(10), 1200).turnsPerMin).toBeCloseTo(0.5, 5);
  });

  test('T2: under 5 minutes or no diarization is not judged', () => {
    expect(speakerSplit({ segments: [seg('Teacher', 0)] }, 200)).toBeNull();
    expect(speakerSplit(null, 1200)).toBeNull();
    expect(speakerSplit({}, 1200)).toBeNull();
    expect(speakerSplit({ segments: [seg('Teacher', 0)] }, null)).toBeNull();
  });

  test('T3: speakerSplitFor is off unless UNSPLIT_SPEAKER_NOTE is true', () => {
    const session = { diarization_data: { segments: [seg('Teacher', 0)] }, audio_duration_seconds: 1200 };
    expect(speakerSplitFor(session, {})).toBeNull();
    expect(speakerSplitFor(session, { UNSPLIT_SPEAKER_NOTE: 'false' })).toBeNull();
    expect(speakerSplitFor(session, { UNSPLIT_SPEAKER_NOTE: 'true' })).toMatchObject({ split: false, reason: 'one_voice' });
    // diarization_data stored as a JSON string is read too
    expect(speakerSplitFor({ ...session, diarization_data: JSON.stringify(session.diarization_data) },
      { UNSPLIT_SPEAKER_NOTE: 'true' })).toMatchObject({ split: false });
  });

  test('T4: the FICO prompt warns about unreliable labels only for an unsplit recording', () => {
    const META = { duration: 1500, language: 'ur', teacherFirstName: 'Zeba', priorFeedback: null, priorAction: null };
    const today = fico.buildAnalysisPrompt('TX', META, null, null);
    expect(fico.buildAnalysisPrompt('TX', { ...META, speakerSplit: null }, null, null)).toBe(today);
    expect(fico.buildAnalysisPrompt('TX', { ...META, speakerSplit: { split: true, reason: null } }, null, null)).toBe(today);

    const p = fico.buildAnalysisPrompt('TX', { ...META, speakerSplit: { split: false, reason: 'one_voice' } }, null, null);
    expect(p).toContain('SPEAKER LABELS ARE NOT RELIABLE');
    expect(p).toMatch(/never score a student indicator 0 only because no "Student:" line appears/i);
    expect(p.indexOf('SPEAKER LABELS ARE NOT RELIABLE')).toBeLessThan(p.indexOf('CLASSROOM TRANSCRIPT:'));
  });
});
