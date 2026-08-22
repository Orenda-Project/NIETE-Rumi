/**
 * The joins the voice branch has to land on, asserted statically. (bd-43520)
 *
 * This feature's whole failure history lives in the gaps between correct pieces. The
 * bd-2529 port was reverted because a state machine returned an action the message
 * handler had no branch for; bd-2718 shipped a router decision whose payload one of
 * the two consumers silently dropped. Both times the unit tests were right and the
 * handset was wrong.
 *
 * Voice adds a third handler to that set — a voice note arrives on its own webhook,
 * so the roll call is only reachable if voice-message.handler routes it BEFORE the
 * pipelines that would otherwise claim the audio. These are source assertions on
 * purpose: the ordering and the wiring are what break, and neither shows up in a
 * unit test of any single piece.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const VOICE_HANDLER = read('bot/shared/handlers/voice-message.handler.js');
const TEXT_HANDLER = read('bot/shared/handlers/text-message.handler.js');
const BOT = read('bot/whatsapp-bot.js');
const ENDPOINT = read('bot/shared/routes/attendance-marking-endpoint.js');

describe('the voice note reaches attendance at all', () => {
  it('voice-message.handler has an attendance branch again', () => {
    // It was a tombstone comment from 2026-08-10 until bd-43520.
    expect(VOICE_HANDLER).toContain('voice-attendance.service');
    expect(VOICE_HANDLER).not.toMatch(/removed 2026-08-10, rebuilding from scratch/);
  });

  it('checks attendance BEFORE comprehension and the reading pipeline', () => {
    // A principal answering "send me a voice note" must not have that audio taken
    // by a five-minute pipeline nobody asked for.
    const attendanceAt = VOICE_HANDLER.indexOf('VoiceAttendance.armed');
    const comprehensionAt = VOICE_HANDLER.indexOf('findActiveFlowByUser');

    expect(attendanceAt).toBeGreaterThan(-1);
    expect(comprehensionAt).toBeGreaterThan(-1);
    expect(attendanceAt).toBeLessThan(comprehensionAt);
  });

  it('is gated on an armed wait, not on the audio looking like a roll call', () => {
    // State is CONTEXT, never a guess. Without the gate every voice note in the
    // deployment would be run through name extraction.
    expect(VOICE_HANDLER).toMatch(/const waiting = await VoiceAttendance\.armed\(/);
  });

  it('opens the register on its REVIEW root, with a voice token', () => {
    expect(VOICE_HANDLER).toMatch(/flowToken: `\$\{user\.id\}:teacher:\$\{waiting\.schoolId\}:voice`/);
  });

  it('stays armed when nothing could be heard, so speaking again works', () => {
    // Disarming on a failed transcription drops the principal back into general
    // chat, where their second attempt becomes a lesson-plan request.
    const failureBranch = VOICE_HANDLER.slice(
      VOICE_HANDLER.indexOf('if (!heard.ok)'),
      VOICE_HANDLER.indexOf('await VoiceAttendance.stashResult'),
    );
    expect(failureBranch).not.toContain('disarm');
    expect(failureBranch).toMatch(/try again/i);
  });
});

describe('the endpoint answers the voice token', () => {
  it('INIT sends a :voice token to REVIEW and a plain staff token to STAFF_DATE', () => {
    const init = ENDPOINT.slice(ENDPOINT.indexOf('async function handleMarkingInit'));
    expect(init).toMatch(/mode === 'voice'/);
    expect(init).toContain('renderReviewScreen');
    expect(init).toContain('renderStaffDateScreen');
  });

  it('REVIEW is a data_exchange screen the endpoint dispatches', () => {
    expect(ENDPOINT).toContain("if (screen === 'REVIEW')");
    expect(ENDPOINT).toContain("if (screen === 'STAFF_DATE')");
  });
});

describe('both consumers arm the wait before asking for the note', () => {
  // AWAIT_VOICE is not an informational action: it has a side effect, and a consumer
  // that only printed its message would ask for a voice note it then ignored.
  [['bot/shared/handlers/text-message.handler.js', TEXT_HANDLER],
    ['bot/whatsapp-bot.js', BOT]].forEach(([label, src]) => {
    it(`${label} arms it`, () => {
      expect(src).toContain('AWAIT_VOICE');
      expect(src).toMatch(/VoiceAttendance\.arm\(/);
    });
  });
});

describe('the copy a principal actually reads', () => {
  // "Mark your class for today." is the body attached to OPEN_REGISTER, and on
  // develop a principal got OPEN_REGISTER — which is what made the whole path read
  // as student attendance. The copy string itself was never the bug; the ROUTE to it
  // was. So this asserts the route, against the real router.
  it('a principal can never reach the action that carries the class copy', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => (table === 'users'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', role: 'principal', school_id: 'sch1' }, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'c1', class_name: 'Grade 5' }], error: null }) }) }) }) }),
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    // eslint-disable-next-line global-require
    const router = require('../../bot/shared/services/attendance-router.service');

    const decision = await router.route('p1');

    // The class copy hangs off OPEN_REGISTER in both consumers; confirm that first,
    // so this test fails loudly if the copy is ever moved somewhere else.
    [TEXT_HANDLER, BOT].forEach((src) => {
      const classCopyAt = src.indexOf('Mark your class for today.');
      expect(classCopyAt).toBeGreaterThan(-1);
      expect(src.slice(0, classCopyAt)).toContain("'OPEN_REGISTER'");
    });

    expect(decision.action).not.toBe('OPEN_REGISTER');
  });

  it('and the staff preamble says what happens next, not "your class"', () => {
    [TEXT_HANDLER, BOT].forEach((src) => {
      const branch = src.slice(src.indexOf("decision.action === 'MARK_TEACHERS'"));
      const teacherCopy = branch.slice(0, branch.indexOf(': '));
      expect(teacherCopy).toMatch(/teachers/i);
      expect(teacherCopy).not.toMatch(/your class/i);
    });
  });

  it('names both options in the AWAIT_VOICE prompt, with an example to copy', () => {
    const router = read('bot/shared/services/attendance-router.service.js');
    const prompt = router.slice(router.indexOf("action: 'AWAIT_VOICE'"));
    expect(prompt).toMatch(/voice note/i);
    // A blank "send a voice note" gets a name with no status. An example gets both.
    expect(prompt).toMatch(/for example/i);
  });
});
