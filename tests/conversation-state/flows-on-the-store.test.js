/**
 * The remaining per-teacher waits move onto the store.
 *
 * The state core fixed the three flows that were on the broken database path. Every
 * other feature kept its own Redis key — which worked, but only until a restart (this
 * deployment's cache has no persistent volume) or until a timer nobody had chosen.
 * Those are fragile rather than broken, and this is where they stop being either.
 *
 * Four `awaiting_video_*` keys collapse into ONE `video` flow with four steps, and the
 * quiz prompts into a `quiz` flow. That is a simplification, not a port: four keys that
 * could coexist become one row that cannot, so the stale-earlier-step case stops
 * existing rather than being handled.
 *
 * The public API of each service is deliberately UNCHANGED — askForTopic /
 * checkAwaitingTopic / clearAwaitingTopic keep their names and signatures — so no
 * caller moves and the diff stays inside the services that own the state.
 *
 * NOT migrated, each for a stated reason:
 *   - the lesson-plan PICKER is keyed on phone, not on the teacher. Moving it means
 *     changing its key, which is a bigger change than its 30-minute window justifies.
 *   - `observe:state` is already this pattern (own store, own ceiling, get/set/clear)
 *     and belongs to a live parallel workstream.
 *   - exam marking is already database-backed with its own table.
 *   - the quiz intent/resume flags are themselves a resume mechanism behind their
 *     own abstraction.
 *   - student-side quiz keys are per-STUDENT, not per-teacher — a different subject.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const mockState = { getState: jest.fn(), setState: jest.fn(), clearState: jest.fn() };
const mockRedis = { redis: { setex: jest.fn(), get: jest.fn(), del: jest.fn() }, get: jest.fn(), set: jest.fn(), delete: jest.fn(), setexWithCeiling: jest.fn() };

jest.mock('../../bot/shared/services/conversation-state.service', () => mockState);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendCarousel: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
  update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
})) }));

const USER = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  jest.clearAllMocks();
  mockState.setState.mockImplementation((u, s) => Promise.resolve({ ...s, stack: [] }));
  mockState.clearState.mockResolvedValue(true);
});

// ── the static half: the old keys are gone from the code that owned them ─────
describe('the migrated keys are gone from their services', () => {
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  it('the video orchestrator no longer builds awaiting_video_* cache keys', () => {
    const src = read('bot/shared/services/video/video-orchestrator.service.js');
    expect(src).not.toMatch(/awaiting_video_(topic|language|customization|style)/);
  });

  it('the menu no longer builds an awaiting_lesson_plan_topic cache key', () => {
    const src = read('bot/shared/services/menu.service.js');
    expect(src).not.toMatch(/awaiting_lesson_plan_topic/);
  });

  it('the quiz orchestrator no longer builds quiz:awaiting_* cache keys', () => {
    const src = read('bot/shared/services/quiz/quiz-orchestrator.service.js');
    expect(src).not.toMatch(/quiz:awaiting_(topic|class)/);
  });

  it('the busy-probe no longer looks for a torn-out feature', () => {
    // Attendance was rebuilt as Flows and keeps no conversational state, but three
    // probes still read its old key — so a teacher could never be reported busy on
    // it, and `/status` could never list it. Dead code pointing at a removed feature.
    const src = read('bot/shared/services/teacher-state.service.js');
    expect(src).not.toMatch(/attendance:session:/);
  });
});

// ── the behavioural half: the flow still works, through the store ────────────
describe('the video flow, on the store', () => {
  const Video = require('../../bot/shared/services/video/video-orchestrator.service');

  it('records each step against one video flow, not four keys', async () => {
    await Video.askForTopic('923000000000', USER, 'sess-1', 'en');

    expect(mockState.setState).toHaveBeenCalledWith(USER, expect.objectContaining({
      flow: 'video',
      step: 'awaiting_topic',
    }));
    // Nothing reaches for the cache for this any more.
    expect(mockRedis.redis.setex).not.toHaveBeenCalled();
  });

  it('reads a step back only when the teacher is actually on it', async () => {
    mockState.getState.mockResolvedValue({ flow: 'video', step: 'awaiting_topic', payload: { sessionId: 'sess-1', language: 'en' }, stack: [] });
    expect(await Video.checkAwaitingTopic(USER)).toMatchObject({ sessionId: 'sess-1' });

    // On a later step, the earlier check must NOT match. Four coexisting keys used to
    // make a stale earlier step readable; one row per teacher makes that impossible.
    mockState.getState.mockResolvedValue({ flow: 'video', step: 'awaiting_style', payload: {}, stack: [] });
    expect(await Video.checkAwaitingTopic(USER)).toBeNull();
  });

  it('does not mistake another feature\'s state for its own', async () => {
    mockState.getState.mockResolvedValue({ flow: 'coaching', step: 'awaiting_topic', payload: {}, stack: [] });
    expect(await Video.checkAwaitingTopic(USER)).toBeNull();
  });

  it('clears scoped to the video flow, so another feature survives', async () => {
    await Video.clearAwaitingTopic(USER);
    expect(mockState.clearState).toHaveBeenCalledWith(USER, { flow: 'video' });
  });

  it('gives every step a deadline the store will accept', async () => {
    // The store refuses an unbounded or over-ceiling TTL, so this asserts the
    // contract is honoured rather than that a specific number was chosen.
    await Video.askForTopic('923000000000', USER, 'sess-1', 'en');
    const [, arg] = mockState.setState.mock.calls[0];
    expect(typeof arg.ttlSeconds).toBe('number');
    expect(arg.ttlSeconds).toBeGreaterThan(0);
    expect(arg.ttlSeconds).toBeLessThanOrEqual(86400);
  });
});

describe('every migrated flow can be offered back', () => {
  const { TASK_LABEL } = require('../../bot/shared/services/conversation-resume.service');

  // A flow the resume sweeper cannot NAME is silently dropped rather than offered.
  // So migrating a flow onto the store without giving it a teacher-facing label
  // would quietly opt it out of the one feature this work exists to deliver.
  it.each(['video', 'quiz', 'lesson_plan', 'coaching', 'reading'])(
    '%s has a teacher-facing name in both languages', (flow) => {
      expect(TASK_LABEL[flow]).toBeDefined();
      expect(TASK_LABEL[flow].en).toBeTruthy();
      expect(TASK_LABEL[flow].ur).toBeTruthy();
      // Never an internal id leaking to a teacher.
      expect(TASK_LABEL[flow].en).not.toMatch(/_/);
    }
  );
});
