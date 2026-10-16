/**
 * The front door: every adult who is not registered reaches the registration Flow.
 *
 * PROD EVIDENCE (niete-logs + NIETE prod, read-only, 2026-10-16): a brand-new number got no
 * welcome and no form — its first message was simply answered. 6,376 adults have messaged
 * and never registered. 25 bare "Register", 3 "Register me" and 16 slash near-misses never
 * opened the form (the keyword branch answered "I'll ask for your name after you try one of
 * my features!"), and /portal handed an unregistered sender a portal setup link.
 *
 * Drives the REAL handleTextMessage. The invite service is the seam: every door must go
 * through it (it owns the token, the copy and the once-only rule — its own suite pins those).
 */

process.env.REGISTRATION_FLOW_ID = 'flow_reg_test';

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/registration-invite.service', () => ({
  sendRegistrationInvite: jest.fn().mockResolvedValue(true),
  offerRegistrationOnce: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/openai.service', () => ({}));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => null),
}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn().mockResolvedValue(false),
  countUserFeatures: jest.fn().mockResolvedValue(0),
  sendNameQuestion: jest.fn().mockResolvedValue(undefined),
  handleNameResponse: jest.fn().mockResolvedValue({ success: true, firstName: 'X' }),
}));
jest.mock('../../bot/shared/services/context.service', () => ({}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/helper-agent.service', () => ({
  detectCapabilityInquiry: jest.fn().mockResolvedValue({ detected: false }),
}));
jest.mock('../../bot/shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn().mockResolvedValue('') }));
jest.mock('../../bot/shared/services/reading-assessment.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({}));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../bot/shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../bot/shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../bot/shared/services/video/video-orchestrator.service', () => ({
  checkAwaitingTopic: jest.fn().mockResolvedValue(null),
  checkAwaitingCustomization: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
jest.mock('../../bot/shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null),
  isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
  setUserLanguage: jest.fn(),
}));
jest.mock('../../bot/shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => null),
  parseSubjectAndGrade: jest.fn(() => ({})),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn().mockResolvedValue(undefined),
  storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert',
   'delete', 'not', 'gte', 'lte', 'is'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
});
jest.mock('../../bot/shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../bot/shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/services/observe/observe-gate', () => ({
  isSchoolLeader: jest.fn(() => false),
  OBSERVE_TRIGGER_RX: /^\/observe\b/i,
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../bot/shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../bot/shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/classes/class-entry.service', () => ({
  openClassManagerFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/handlers/roster-command', () => ({
  handleRosterCommand: jest.fn().mockResolvedValue(undefined),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Invite = require('../../bot/shared/services/registration-invite.service');
const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');
const MenuService = require('../../bot/shared/services/menu.service');
const { handlePortalCommand } = require('../../bot/shared/handlers/portal-command.handler');
const { openClassManagerFlow } = require('../../bot/shared/services/classes/class-entry.service');
const { handleRosterCommand } = require('../../bot/shared/handlers/roster-command');
const { getOrCreateUser } = require('../../bot/shared/database/bot-helpers');
const { handleTextMessage } = require('../../bot/shared/handlers/text-message.handler');

const FROM = '923001234567';
const MESSAGE = { id: 'wamid.frontdoor.test' };

const newAdult = (over = {}) => ({
  id: 'user-new-1',
  phone_number: FROM,
  name: null,
  role: 'teacher',
  preferred_language: 'en',
  registration_completed: false,
  registration_state: 'unregistered',
  registration_pending_name: false,
  registration_started_at: null,
  ...over,
});
const registered = (over = {}) => newAdult({ id: 'user-reg-1', name: 'Ayesha Bano', school_id: 'school-1', ...over });

const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1]));
const invitedFor = (reason) => Invite.sendRegistrationInvite.mock.calls.some((c) => c[0] && c[0].reason === reason);

beforeEach(() => {
  jest.clearAllMocks();
  FeatureRegistrationService.isPendingName.mockResolvedValue(false);
});

describe('registration requests open the Flow, whoever sends them', () => {
  test.each(['Register', 'Register me', 'i need to register', '/registered', '/ register', 'Type/register', 'رجسٹر'])(
    '%j from an unregistered adult → the Flow, never the old "try a feature first" reply',
    async (body) => {
      await handleTextMessage(MESSAGE, FROM, body, newAdult());
      expect(Invite.sendRegistrationInvite).toHaveBeenCalledTimes(1);
      expect(Invite.sendRegistrationInvite.mock.calls[0][0]).toEqual(expect.objectContaining({ phone: FROM }));
      expect(sentTexts().some((t) => /ask for your name|نام پوچھوں گی/.test(t))).toBe(false);
      expect(FeatureRegistrationService.sendNameQuestion).not.toHaveBeenCalled();
    },
  );

  test('a registered teacher who says "register me" gets the Flow to update her details, not "already registered"', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register me please', registered());
    expect(Invite.sendRegistrationInvite).toHaveBeenCalledTimes(1);
    expect(sentTexts().some((t) => t.includes('already registered'))).toBe(false);
  });

  test('/register itself goes through the one invite sender', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', newAdult());
    expect(Invite.sendRegistrationInvite).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled(); // no second, hand-rolled sender
  });
});

describe('/portal', () => {
  test('from an unregistered adult: the registration Flow, not a portal setup link', async () => {
    await handleTextMessage(MESSAGE, FROM, '/portal', newAdult());
    expect(invitedFor('portal')).toBe(true);
    expect(handlePortalCommand).not.toHaveBeenCalled();
  });

  test('from a registered teacher: the portal command as before', async () => {
    await handleTextMessage(MESSAGE, FROM, '/portal', registered());
    expect(handlePortalCommand).toHaveBeenCalledTimes(1);
    expect(Invite.sendRegistrationInvite).not.toHaveBeenCalled();
  });
});

describe('a feature that needs a school asks an unregistered adult to register first', () => {
  test('/classes', async () => {
    await handleTextMessage(MESSAGE, FROM, '/classes', newAdult());
    expect(invitedFor('school_feature')).toBe(true);
    expect(openClassManagerFlow).not.toHaveBeenCalled();
  });

  test('/roster', async () => {
    await handleTextMessage(MESSAGE, FROM, '/roster', newAdult());
    expect(invitedFor('school_feature')).toBe(true);
    expect(handleRosterCommand).not.toHaveBeenCalled();
  });

  test('a registered teacher reaches /classes as before', async () => {
    await handleTextMessage(MESSAGE, FROM, '/classes', registered());
    expect(openClassManagerFlow).toHaveBeenCalledTimes(1);
    expect(Invite.sendRegistrationInvite).not.toHaveBeenCalled();
  });
});

describe('after her first reply, a new adult is offered the form once', () => {
  test('her message is answered FIRST, then the offer', async () => {
    await handleTextMessage(MESSAGE, FROM, '/menu', newAdult());
    expect(MenuService.sendMenu).toHaveBeenCalledTimes(1);
    expect(Invite.offerRegistrationOnce).toHaveBeenCalledTimes(1);
    expect(Invite.offerRegistrationOnce.mock.calls[0][0]).toEqual(expect.objectContaining({
      phone: FROM, reason: 'first_reply', user: expect.objectContaining({ id: 'user-new-1' }),
    }));
    expect(MenuService.sendMenu.mock.invocationCallOrder[0])
      .toBeLessThan(Invite.offerRegistrationOnce.mock.invocationCallOrder[0]);
  });

  test("a child's handset (student-ingress lets her /video and quiz traffic through) is never offered it", async () => {
    await handleTextMessage(MESSAGE, FROM, '/menu', newAdult({ persona: 'student' }));
    expect(Invite.offerRegistrationOnce).not.toHaveBeenCalled();
  });

  test('a registered teacher is never offered it', async () => {
    await handleTextMessage(MESSAGE, FROM, '/menu', registered());
    expect(Invite.offerRegistrationOnce).not.toHaveBeenCalled();
  });

  test('not offered a second time in the turn that already sent the Flow', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', newAdult());
    expect(Invite.offerRegistrationOnce).not.toHaveBeenCalled();
  });

  test('an outage is not a new person: no offer when the account lookup failed', async () => {
    getOrCreateUser.mockRejectedValueOnce(Object.assign(new Error('522'), { code: '522' }));
    await handleTextMessage(MESSAGE, FROM, '/menu', null);
    expect(Invite.offerRegistrationOnce).not.toHaveBeenCalled();
  });

  test('the offer never breaks the reply: a throwing offer is swallowed', async () => {
    Invite.offerRegistrationOnce.mockRejectedValueOnce(new Error('db down'));
    await expect(handleTextMessage(MESSAGE, FROM, '/menu', newAdult())).resolves.toBeUndefined();
    expect(MenuService.sendMenu).toHaveBeenCalledTimes(1);
  });
});
