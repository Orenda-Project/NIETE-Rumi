/**
 * Child test v2 — the review Flow is created on the SANDBOX account as a DRAFT and never published here
 * (bd-s1oo0.46.4). Publishing is L0's step, after the deploy that can receive its completions.
 */
const { planDraft, FLOW_NAME, checkSandboxTarget } = require('../../../bot/scripts/setup/create-child-test-review-flow-draft');

const SANDBOX = { WHATSAPP_BOT_NUMBER: '+92 302 5502255', SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', APP_URL: 'https://bot-sandbox.up.railway.app' };

test('the sandbox guard is the check Flow\'s guard: anything but the sandbox account is refused', () => {
  expect(checkSandboxTarget(SANDBOX, '+92 302 5502255')).toEqual({ ok: true });
  expect(checkSandboxTarget({ ...SANDBOX, SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' }, '+92 302 5502255').ok).toBe(false);
  expect(checkSandboxTarget(SANDBOX, '+92 320 6281951').ok).toBe(false);
});

test('no flow of that name: create one; a DRAFT: upload to it; a PUBLISHED one: refuse (a new version is L0\'s call)', () => {
  expect(FLOW_NAME).toBe('Child Test Review');
  expect(planDraft([])).toEqual({ action: 'create' });
  expect(planDraft([{ id: '9', name: 'Child Test Review', status: 'DRAFT' }])).toEqual({ action: 'upload', flowId: '9' });
  expect(planDraft([{ id: '9', name: 'Child Test Review', status: 'PUBLISHED' }])).toMatchObject({ action: 'refuse' });
  expect(planDraft([{ id: '7', name: 'Child Test Check', status: 'DRAFT' }])).toEqual({ action: 'create' });
});
