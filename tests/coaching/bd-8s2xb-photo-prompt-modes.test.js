/**
 * bd-8s2xb (T1–T3) — the FICO prompt's photo channel, per mode.
 *
 * Today `buildAnalysisPrompt` receives the vision description as its 4th arg and
 * discards it: the only trace is a one-line "Visual evidence is available" notice
 * (bd-drg79 found the description in 0 of 4,703 prompts it should have been in).
 * These tests build the REAL prompt and assert on its text.
 *
 *   T1  mode 'text'  → the description is IN the prompt, with the "Photo:" rule
 *   T2  modes 'off' | 'image' | 'both' → no legacy notice; 'both' has description AND attach line
 *   T3  mode 'note' (today's default) and no `metadata.photo` at all → byte-identical to today
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const META = { duration: 1500, language: 'ur', teacherFirstName: 'Zeba', priorFeedback: null, priorAction: null };
const DESC = 'Classroom photo 1 (submitted by the teacher): ZXQ-PHOTO-TEXT the board shows the objective.';
const LEGACY = 'CLASSROOM PHOTOS: Visual evidence is available.';

describe('bd-8s2xb — FICO prompt photo modes', () => {
  test('T1: text mode inserts the description and the Photo: rule', () => {
    const p = fico.buildAnalysisPrompt('TX', { ...META, photo: { mode: 'text', text: DESC, count: 1 } }, null, DESC);
    expect(p).toContain('ZXQ-PHOTO-TEXT');
    expect(p).toContain('start that indicator\'s evidence AND its evidence_summary with "Photo:"');
    expect(p).not.toContain(LEGACY);
    // the block lands before the transcript, where the model reads context
    expect(p.indexOf('ZXQ-PHOTO-TEXT')).toBeLessThan(p.indexOf('CLASSROOM TRANSCRIPT:'));
  });

  test('T2: off / image / both — no legacy notice; both carries description + attach line', () => {
    const off = fico.buildAnalysisPrompt('TX', { ...META, photo: { mode: 'off', text: DESC, count: 1 } }, null, DESC);
    expect(off).not.toContain(LEGACY);
    expect(off).not.toContain('ZXQ-PHOTO-TEXT');
    expect(off).not.toContain('CLASSROOM PHOTO');

    const image = fico.buildAnalysisPrompt('TX', { ...META, photo: { mode: 'image', text: DESC, count: 2 } }, null, DESC);
    expect(image).not.toContain(LEGACY);
    expect(image).not.toContain('ZXQ-PHOTO-TEXT');
    expect(image).toContain('CLASSROOM PHOTOS (2 submitted by the teacher');
    expect(image).toContain('attached to this message');

    const both = fico.buildAnalysisPrompt('TX', { ...META, photo: { mode: 'both', text: DESC, count: 3 } }, null, DESC);
    expect(both).not.toContain(LEGACY);
    expect(both).toContain('ZXQ-PHOTO-TEXT');
    expect(both).toContain('CLASSROOM PHOTOS (3 submitted by the teacher');
    expect(both).toContain('also attached to this message');
  });

  test('T3: note mode and absent metadata.photo reproduce today\'s prompt byte-for-byte', () => {
    const today = fico.buildAnalysisPrompt('TX', META, null, DESC);            // no metadata.photo — today's callers
    const note = fico.buildAnalysisPrompt('TX', { ...META, photo: { mode: 'note', text: DESC, count: 1 } }, null, DESC);
    expect(note).toBe(today);
    expect(today).toContain(LEGACY);
    expect(today).not.toContain('ZXQ-PHOTO-TEXT');
    // and with no photo at all, no notice — unchanged
    const none = fico.buildAnalysisPrompt('TX', META, null, null);
    expect(none).not.toContain('CLASSROOM PHOTO');
  });
});
