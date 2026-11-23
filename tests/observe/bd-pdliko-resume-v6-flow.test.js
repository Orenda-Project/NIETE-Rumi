'use strict';
/**
 * Queue #191 — a coach reopening an unfinished FICO17 v6 visit from her list got the OLD (V3) review Flow.
 *
 * Production, 16-19 Nov: the [open the form] tap (observe-resume sendForm) always sent OBSERVE_MEWAKA_FLOW_ID, the V3
 * Flow, whatever the visit was stamped with. A v6 visit's analysis then filled V3 screens (no level choices), and the
 * endpoint refused every page ("v6 screen refused — reason or level missing": the V3 screens never post the v6 fields
 * r_C3/why_C3 …). 11 v6 visits from 10 coaches were hit; 5 were cancelled by the coaches, 5 stayed stuck. The first
 * send (observe-draft) already picked the Flow by the stamp; the reopen did not.
 *
 * Now the reopen sends the Flow that matches the visit: the v6 Flow for a v6 visit, the V3 Flow for a V3 one. A v6
 * visit with no v6 Flow id configured gets the text fallback, never the V3 Flow.
 *
 * Real: /observe's resume (row tapped → [open the form] → sendForm) and the v6 stamp reader. Mocked: the database
 * (in-memory), WhatsApp.
 */
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Resume = require('../../bot/shared/services/observe/observe-resume.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en', role: 'coach' };
const PHONE = COACH.phone_number;
const V3_FLOW = 'flow-v3';
const V6_FLOW = 'flow-v6';

function visit(id, { framework = null, analysisFramework = framework || 'fico' } = {}) {
  const now = new Date().toISOString();
  return {
    id, status: 'awaiting_observer_review', created_at: now, updated_at: now,
    user_id: 'teacher-1', observer_user_id: COACH.id, framework,
    analysis_data: { framework: analysisFramework, domains: {} },
    transcript_text: 'x', audio_id: 'a1',
  };
}

function seed(rows) {
  mockFake = createFakeSupabase({ users: [COACH], coaching_sessions: rows });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBSERVE_MEWAKA_FLOW_ID = V3_FLOW;
  process.env.OBSERVE_FICO17_V6_FLOW_ID = V6_FLOW;
});
afterAll(() => {
  delete process.env.OBSERVE_MEWAKA_FLOW_ID;
  delete process.env.OBSERVE_FICO17_V6_FLOW_ID;
});

const sentFlowIds = () => WhatsAppService.sendFlow.mock.calls.map(([, opts]) => opts.flowId);

describe('reopening an unfinished visit sends the Flow its rubric was stamped with', () => {
  test('a FICO17 v6 visit: the row tap offers [open the form], and the tap sends the v6 Flow, not the V3 one', async () => {
    seed([visit('v6-visit', { framework: 'fico17_v6' })]);
    await Resume.resume('v6-visit', PHONE, COACH);
    const [, prompt] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(prompt.buttons[0].id).toBe('observe_form_v6-visit');

    await Resume.sendForm('v6-visit', PHONE, COACH);
    expect(sentFlowIds()).toEqual([V6_FLOW]);
    const [to, opts] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(opts.flowToken).toBe(`${COACH.id}:v6-visit`);
  });

  test('a v6 visit known only by its analysis (no column stamp) is still a v6 visit', async () => {
    seed([visit('v6-by-analysis', { framework: null, analysisFramework: 'fico17_v6' })]);
    await Resume.sendForm('v6-by-analysis', PHONE, COACH);
    expect(sentFlowIds()).toEqual([V6_FLOW]);
  });

  test('a V3 visit still gets the V3 Flow', async () => {
    seed([visit('v3-visit', { framework: 'fico' })]);
    await Resume.sendForm('v3-visit', PHONE, COACH);
    expect(sentFlowIds()).toEqual([V3_FLOW]);
  });

  test('a v6 visit on a deployment with no v6 Flow id gets the text fallback, never the V3 Flow', async () => {
    delete process.env.OBSERVE_FICO17_V6_FLOW_ID;
    seed([visit('v6-visit', { framework: 'fico17_v6' })]);
    await Resume.sendForm('v6-visit', PHONE, COACH);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, observeStrings('en').flow_fallback);
  });
});
