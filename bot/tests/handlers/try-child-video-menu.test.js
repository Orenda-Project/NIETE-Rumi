'use strict';
require('dotenv').config();
/**
 * bd-2475 — the /video command's fallback for an anonymous quiz-taking
 * child: "you can always come back via /video" only holds if /video
 * actually works for someone with no `users` row. tryChildVideoMenu is the
 * extracted, independently-testable piece of that gate (see text-message
 * .handler.js's `/video` block — it only runs inside the existing
 * `if (!user)` branch, so it can never affect a registered user's path).
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn(),
}));
jest.mock('../../shared/utils/constants', () => ({ STUDENT_VIDEOS_FLOW_ID: 'flow-123' }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');
const { tryChildVideoMenu } = require('../../shared/handlers/text-message.handler');

const PHONE = '923001234567';

function stubSessionQuery(shareCodeId) {
  supabase.from.mockImplementation((table) => {
    expect(table).toBe('quiz_sessions');
    const chain = {
      select: () => chain, eq: () => chain, not: () => chain,
      order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: shareCodeId ? { share_code_id: shareCodeId } : null }),
    };
    return chain;
  });
}

beforeEach(() => jest.clearAllMocks());

test('unknown phone (no student match) — falls through, no Flow sent', async () => {
  StudentIdentity.findByPhone.mockResolvedValue([]);
  expect(await tryChildVideoMenu(PHONE, 'en')).toBe(false);
  expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
});

test('siblings on one handset (ambiguous) — falls through, no Flow sent', async () => {
  StudentIdentity.findByPhone.mockResolvedValue([
    { id: 'stu-1', student_name: 'A' }, { id: 'stu-2', student_name: 'B' },
  ]);
  expect(await tryChildVideoMenu(PHONE, 'en')).toBe(false);
  expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
});

test('single known student but never took a share_link quiz — falls through', async () => {
  StudentIdentity.findByPhone.mockResolvedValue([{ id: 'stu-1', student_name: 'Ayesha' }]);
  stubSessionQuery(null);
  expect(await tryChildVideoMenu(PHONE, 'en')).toBe(false);
  expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
});

test('single known student with quiz history — opens the Flow with a childpick token', async () => {
  StudentIdentity.findByPhone.mockResolvedValue([{ id: 'stu-1', student_name: 'Ayesha' }]);
  stubSessionQuery('sc-9');
  expect(await tryChildVideoMenu(PHONE, 'ur')).toBe(true);
  expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
  const [to, flowData] = WhatsAppService.sendFlow.mock.calls[0];
  expect(to).toBe(PHONE);
  expect(flowData.flowId).toBe('flow-123');
  const parsed = ChildFlowToken.parse(flowData.flowToken);
  expect(parsed).toMatchObject({ shareCodeId: 'sc-9', studentId: 'stu-1', language: 'ur' });
});

test('a lookup error never throws — fails closed to the existing noAccount path', async () => {
  StudentIdentity.findByPhone.mockRejectedValue(new Error('db down'));
  await expect(tryChildVideoMenu(PHONE, 'en')).resolves.toBe(false);
});
