/**
 * bd-88krt — cancelling a visit must not tell the coach to record a lesson (TDD).
 *
 * Operator, live on staging 2026-08-17: cancelled a visit and still received
 * "When the lesson starts, record and send me the audio". The cancel itself
 * worked — the visit was gone from the schedule — but the message was wrong.
 *
 * Root cause: handleObserveVisitFlow special-cases only 'debrief' and 'done';
 * EVERYTHING else falls through to VisitHandler.handle(...'complete'...) plus
 * buildVisitCapturePrompt. My cancel path set observe_visit_action='cancelled',
 * so it landed in that fall-through.
 *
 * Second defect in the same place: the Flow's SUCCESS screen carries STATIC
 * English ("Observation scheduled"), so a cancel showed a scheduling
 * confirmation. Per the language protocol every teacher/coach-facing string is
 * per-language data, never hardcoded — so the acks follow the existing
 * SCHEDULE_DONE_TEMPLATES + buildScheduleDoneAck pattern rather than inventing
 * a new one.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  buildVisitCancelledAck, buildVisitRescheduledAck, buildVisitCapturePrompt,
} = require('../../shared/services/observe/observe-strings');

describe('bd-88krt · the cancellation ack', () => {
  it('confirms the cancellation and never asks for a recording', () => {
    const msg = buildVisitCancelledAck('en', { teacherName: 'Ayesha Khan' });
    expect(msg).toMatch(/cancel/i);
    expect(msg).toContain('Ayesha Khan');
    // The ask is what must be gone. Saying "nothing to record" is reassurance
    // and reads well, so forbid the imperative, not the word.
    expect(msg).not.toMatch(/record (it|the lesson|and send)|send me the audio/i);
  });

  it('exists in every language this market serves — never a hardcoded English string', () => {
    for (const lang of ['en', 'ur']) {
      const msg = buildVisitCancelledAck(lang, { teacherName: 'Ayesha Khan' });
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/\{name\}|\{date\}|\{slot\}/);   // every token filled
    }
    // Urdu must actually be Urdu, not English text under an 'ur' key
    expect(/[؀-ۿ]/.test(buildVisitCancelledAck('ur', { teacherName: 'A' }))).toBe(true);
  });

  it('falls back safely on an unknown language rather than throwing', () => {
    expect(() => buildVisitCancelledAck('fr', { teacherName: 'A' })).not.toThrow();
    expect(buildVisitCancelledAck(null, {})).toBeTruthy();
  });

  it('reads cleanly when the teacher name is unknown', () => {
    const msg = buildVisitCancelledAck('en', {});
    expect(msg).not.toMatch(/\{name\}|undefined|null/);
  });
});

describe('bd-88krt · the reschedule ack', () => {
  it('states the new date and time, and never asks for a recording', () => {
    const msg = buildVisitRescheduledAck('en', { teacherName: 'Ayesha Khan', date: '2026-08-25', slot: '11:30' });
    expect(msg).toContain('Ayesha Khan');
    expect(msg).toMatch(/25 Aug|2026-08-25/);
    expect(msg).toContain('11:30');
    expect(msg).not.toMatch(/record (it|the lesson|and send)|send me the audio/i);
  });

  it('is written per language, with real Urdu', () => {
    const ur = buildVisitRescheduledAck('ur', { teacherName: 'A', date: '2026-08-25', slot: '11:30' });
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
    expect(ur).not.toMatch(/\{name\}|\{date\}|\{slot\}/);
  });

  it('survives a missing slot', () => {
    const msg = buildVisitRescheduledAck('en', { teacherName: 'A', date: '2026-08-25' });
    expect(msg).not.toMatch(/\{slot\}|undefined|null/);
  });
});

describe('bd-88krt · the capture prompt is still the capture prompt', () => {
  it('the recording ask is unchanged for the paths that DO need a recording', () => {
    const msg = buildVisitCapturePrompt('en', { teacherName: 'Ayesha', framework: 'FICO' });
    expect(msg.toLowerCase()).toMatch(/record/);
  });
});

describe('bd-88krt · the completion handler routes cancel/reschedule away from the capture prompt', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/handlers/flow-response.handler.js'), 'utf8');

  it('handles cancelled and rescheduled explicitly, before the fall-through', () => {
    expect(src).toMatch(/visitAction === 'cancelled'/);
    expect(src).toMatch(/visitAction === 'rescheduled'/);
    const iCancel = src.indexOf("visitAction === 'cancelled'");
    // indexOf would otherwise find the IMPORT at the top of the file, not the
    // call — which made this assertion meaningless.
    const iFall = src.indexOf("buildVisitCapturePrompt(observeLang");
    expect(iCancel).toBeGreaterThan(-1);
    expect(iCancel).toBeLessThan(iFall);      // must return BEFORE the prompt
  });

  it('uses the per-language builders, not an inline string', () => {
    expect(src).toMatch(/buildVisitCancelledAck/);
    expect(src).toMatch(/buildVisitRescheduledAck/);
  });
});
