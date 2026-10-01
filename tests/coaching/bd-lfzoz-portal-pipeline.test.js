/**
 * bd-lfzoz — the three places a PORTAL row must be told apart from a WhatsApp one.
 *
 * A portal row (R2 key portal_<id>) rides the same pipeline as a WhatsApp
 * recording. Everything is shared EXCEPT the debrief, which must stay off
 * WhatsApp (operator). That produces exactly three seams, each pinned here with
 * a WhatsApp twin that must keep passing unchanged:
 *
 *   1. analysis → reflection hand-off: a portal row's question is generated and
 *      STORED (silent), not voiced into her chat; no "Step 3/5: Let's reflect"
 *      message announcing a question that will never arrive there.
 *
 *   2. the WhatsApp handlers: any text or voice note from a teacher with a
 *      session at conducting_conversation is taken as her reflective answer,
 *      and a slash command ABANDONS that session. For a portal session — whose
 *      question she was never shown on WhatsApp — a stray "hi" would be filed
 *      as her answer. Both handlers must look past portal rows.
 *
 *   3. the mid-flight watchdog: a session stuck at 'transcribing' with no
 *      WhatsApp media id is FAILED as unrecoverable. A portal row has no media
 *      id by construction — its audio is in R2 — so it must be retried instead.
 *
 * A portal row is recognised by its R2 key (see isPortalSession), so no column
 * is added and every existing row reads exactly as it does today.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

describe('1. analysis → reflection hand-off', () => {
  let sendMessage;
  let conduct;

  function load() {
    jest.resetModules();
    sendMessage = jest.fn().mockResolvedValue(true);
    conduct = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage, sendAudio: jest.fn() }));
    jest.doMock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
      conductReflectiveConversation: conduct,
    }));
    const Svc = require('../../bot/shared/services/coaching/analysis-processor.service');
    Svc._resolveSessionLanguage = jest.fn().mockResolvedValue('ur');
    return Svc;
  }

  test('a WhatsApp row is UNCHANGED: Step 3 is announced and the question is sent to her chat', async () => {
    const Svc = load();
    await Svc._handOffToReflection({ id: 'cs-1', audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/683335f3-9041-45eb_1790852380454.ogg' }, 'cs-1', '923001234567', { pauseMs: 0 });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(conduct).toHaveBeenCalledWith('cs-1', '923001234567');
  });

  test('a WhatsApp row before transcription (no audio_url yet) behaves exactly the same', async () => {
    const Svc = load();
    await Svc._handOffToReflection({ id: 'cs-1' }, 'cs-1', '923001234567', { pauseMs: 0 });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(conduct).toHaveBeenCalledWith('cs-1', '923001234567');
  });

  test('a portal row generates and stores the question silently, with nothing sent to WhatsApp', async () => {
    const Svc = load();
    await Svc._handOffToReflection({ id: 'cs-2', audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a' }, 'cs-2', '923001234567', { pauseMs: 0 });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(conduct).toHaveBeenCalledWith('cs-2', '923001234567', 1, { silent: true });
  });

  test('processAnalysis actually calls the hand-off (it is not dead code beside the old inline call)', () => {
    const src = fs.readFileSync(
      path.join(REPO, 'bot/shared/services/coaching/analysis-processor.service.js'), 'utf8',
    );
    expect(src).toMatch(/this\._handOffToReflection\(\s*session\s*,\s*coachingSessionId\s*,\s*from\s*\)/);
    // The old inline call must be gone, or a portal row would get BOTH: the
    // WhatsApp-shaped call may exist exactly once, inside the hand-off itself.
    const call = 'ReflectiveConversationService.conductReflectiveConversation(coachingSessionId, from);';
    const hits = src.split(call).length - 1;
    expect(hits).toBe(1);
    const handOffAt = src.indexOf('static async _handOffToReflection(');
    const nextMethodAt = src.indexOf('static async ', handOffAt + 1);
    const callAt = src.indexOf(call);
    expect(handOffAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(handOffAt);
    expect(callAt).toBeLessThan(nextMethodAt);
  });
});

describe('2. WhatsApp handlers look past a portal session', () => {
  test('the predicate: WhatsApp rows count, portal rows do not', () => {
    const { isWhatsAppReflectiveSession } = require('../../bot/shared/services/coaching/portal-coaching.service');
    expect(isWhatsAppReflectiveSession({ id: 'a', audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/683335f3-9041-45eb_1790852380454.ogg' })).toBe(true);
    expect(isWhatsAppReflectiveSession({ id: 'a' })).toBe(true);
    expect(isWhatsAppReflectiveSession({ id: 'a', audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a' })).toBe(false);
    expect(isWhatsAppReflectiveSession(null)).toBe(false);
  });

  // The handlers are not executable in isolation (each pulls in the whole
  // message pipeline), so the wiring is pinned on source text — comments
  // stripped, so the explanation beside the guard cannot satisfy it.
  const code = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test.each([
    'bot/shared/handlers/text-message.handler.js',
    'bot/shared/handlers/voice-message.handler.js',
  ])('%s gates its reflective-answer branch on isWhatsAppReflectiveSession', (rel) => {
    const src = code(rel);
    expect(src).toMatch(/if \(isWhatsAppReflectiveSession\(activeCoaching\)\)/);
    expect(src).not.toMatch(/if \(activeCoaching\) \{/);
  });
});

describe('3. mid-flight watchdog', () => {
  const { classifyStuckMidFlightSession, MIDFLIGHT_STUCK_AGE_MS } =
    require('../../bot/shared/services/coaching/coaching-stale-recovery');
  const now = Date.parse('2026-10-01T12:00:00Z');
  const stale = new Date(now - MIDFLIGHT_STUCK_AGE_MS - 60_000).toISOString();

  test('WhatsApp row stuck at transcribing with no media id is still failed — unchanged', () => {
    expect(classifyStuckMidFlightSession(
      { status: 'transcribing', updated_at: stale, audio_id: null, audio_url: null }, now,
    )).toMatchObject({ action: 'fail', reason: 'no_audio_to_transcribe' });
    // a legacy row whose audio_url is a WhatsApp-shaped key keeps today's decision too
    expect(classifyStuckMidFlightSession(
      { status: 'transcribing', updated_at: stale, audio_id: null, audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/683335f3-9041-45eb_1790852380454.ogg' }, now,
    )).toMatchObject({ action: 'fail', reason: 'no_audio_to_transcribe' });
  });

  test('WhatsApp row stuck at transcribing WITH a media id is retried — unchanged', () => {
    expect(classifyStuckMidFlightSession(
      { status: 'transcribing', updated_at: stale, audio_id: 'wamid.X' }, now,
    )).toMatchObject({ action: 'retry', queue: 'transcription' });
  });

  test('portal row stuck at transcribing is retried from R2, not failed', () => {
    expect(classifyStuckMidFlightSession(
      { status: 'transcribing', updated_at: stale, audio_id: null, audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a' }, now,
    )).toMatchObject({ action: 'retry', queue: 'transcription' });
  });
});

test('the watchdog worker selects audio_url, or the planner never sees a portal row', () => {
  const src = fs.readFileSync(path.join(REPO, 'bot/workers/stale-session.worker.js'), 'utf8');
  const sel = src.match(/\.select\('id, user_id, status, created_at, updated_at, audio_id,[^']*'\)/);
  expect(sel && sel[0]).toMatch(/\baudio_url\b/);
});

describe('4. transcription → the photo/LP gate', () => {
  const src = fs.readFileSync(path.join(REPO, 'bot/shared/services/coaching/transcription-processor.service.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('a portal row leaves through afterTranscription BEFORE the WhatsApp photo prompt is built', () => {
    const portalAt = src.search(/if \(isPortalSession\(session\)\) \{\s*await PortalCoaching\.afterTranscription\(session, coachingSessionId, from\);/);
    // The prompt builder became buildPhotoPromptWithLead(…, priorReminder) in the Meta bill cut (NC4):
    // the prior-commitment reminder opens the offer. Same call site, same order.
    const promptAt = src.search(/buildPhotoPrompt(?:WithLead)?\(coachingSessionId, userLanguage/);
    expect(portalAt).toBeGreaterThan(-1);
    expect(promptAt).toBeGreaterThan(portalAt);
    // and it returns, so the prompt is never reached for a portal row
    const between = src.slice(portalAt, promptAt);
    expect(between).toMatch(/return;/);
  });

  test('the leader-observation branch still comes first — untouched', () => {
    const observeAt = src.indexOf('TranscriptionProcessorService.observePostTranscription(coachingSessionId, session, from)');
    const portalAt = src.search(/if \(isPortalSession\(session\)\)/);
    expect(observeAt).toBeGreaterThan(-1);
    expect(observeAt).toBeLessThan(portalAt);
  });
});
