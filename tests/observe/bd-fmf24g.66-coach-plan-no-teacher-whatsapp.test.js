'use strict';
/**
 * bd-fmf24g.66 — a COACH's observation has the TEACHER as its session user (portal-observe.service
 * inserts `user_id: ownerUserId`, `observer_user_id: coach`). The plan the COACH attached that turns out
 * not to be a lesson plan, or that cannot be read, must not send the TEACHER a WhatsApp: she never
 * attached it. The coach sees the state in the app ("Couldn't read"). A teacher's own upload still
 * gets its message.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Worker = require('../../bot/workers/lesson-plan-extraction.worker');

function sessionRow(observationType) {
  const row = {
    id: 'cs-1', observation_type: observationType, lesson_plan_format: 'pdf',
    users: { name: 'Ayesha Bibi', phone_number: '920000000001', preferred_language: 'en' },
  };
  const chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), single: jest.fn(async () => ({ data: row, error: null })) };
  supabase.from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => { jest.clearAllMocks(); });

describe.each([
  ['notifyNotLessonPlan', 'not a lesson plan'],
  ['notifyFormatIssue', 'unreadable file'],
])('%s (%s)', (method) => {
  test('POSITIVE CONTROL: a teacher who uploaded the plan herself is told', async () => {
    sessionRow(null);
    await Worker[method]('cs-1');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][0]).toBe('920000000001');
  });

  test('a coach observation sends the teacher nothing', async () => {
    sessionRow('leader_observation');
    await Worker[method]('cs-1');
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});
