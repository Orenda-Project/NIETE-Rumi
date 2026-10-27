/**
 * bd-v0toag.124 — the commit prompt goes free-form after a report that went as the share template.
 *
 * bd-v0toag.106 sends the hero report as the `share_dc_report_v1` template when her 24 h window is closed, and skips
 * the voice debrief and the survey on that path. The commit prompt ("Will you commit to trying this in your next
 * class?" with Yes / Later / No) was not skipped: it went free-form and Meta refused it with 131047. On 27 Oct 2026
 * all 62 report-part failures on prod were this prompt (part 'buttons'), each within 10 minutes of a template send
 * to the same teacher. Skipping the prompt must not let the free-form session-complete line go out instead.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fs = require('fs');
const path = require('path');

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../shared/services/coaching/report-piece-once', () => ({
  claimPiece: jest.fn(() => Promise.resolve(true)),
  releasePiece: jest.fn(() => Promise.resolve()),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const pieces = require('../../shared/services/coaching/report-piece-once');
const { sendCommitPrompt } = require('../../shared/services/coaching/report-commit-prompt');

const cardCopy = {
  sessionCompleteLead: 'Session complete.',
  commitPrompt: 'Will you commit to trying this in your next class?',
  commitButtons: { yes: 'Yes', later: 'Later', no: 'No' },
};
const track = { opts: jest.fn(() => ({ part: 'buttons' })), record: jest.fn(() => Promise.resolve()) };
const args = (followUps) => ({ followUps, phone: '920000000000', coachingSessionId: 's1', cardCopy, track });

beforeEach(() => jest.clearAllMocks());

describe('sendCommitPrompt', () => {
  test('report went as the template → no prompt, no claim, no failed part, completion counted as said', async () => {
    const announced = await sendCommitPrompt(args(false));
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(pieces.claimPiece).not.toHaveBeenCalled();
    expect(track.record).not.toHaveBeenCalled();
    expect(announced).toBe(true);
  });

  test('window open → the prompt goes as before, led by the completion line', async () => {
    const announced = await sendCommitPrompt(args(true));
    expect(pieces.claimPiece).toHaveBeenCalledWith('s1', 'commit_prompt');
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledWith('920000000000', {
      body: 'Session complete.\n\nWill you commit to trying this in your next class?',
      buttons: [
        { id: 'card_yes_s1', title: 'Yes' },
        { id: 'card_later_s1', title: 'Later' },
        { id: 'card_no_s1', title: 'No' },
      ],
    }, { part: 'buttons' });
    expect(track.record).toHaveBeenCalledWith('buttons', true);
    expect(announced).toBe(true);
  });

  test('a failed send gives the claim back', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValueOnce(false);
    await sendCommitPrompt(args(true));
    expect(track.record).toHaveBeenCalledWith('buttons', false);
    expect(pieces.releasePiece).toHaveBeenCalledWith('s1', 'commit_prompt');
  });

  test('already sent by an earlier run → nothing sent, completion counted as said', async () => {
    pieces.claimPiece.mockResolvedValueOnce(false);
    expect(await sendCommitPrompt(args(true))).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('no completion lead → the standalone completion line is still owed', async () => {
    expect(await sendCommitPrompt({ ...args(true), cardCopy: { ...cardCopy, sessionCompleteLead: '' } })).toBe(false);
  });
});

describe('report-generator wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../shared/services/coaching/report-generator.service.js'), 'utf8');

  test('the commit prompt goes through sendCommitPrompt with followUps', () => {
    expect(src).toMatch(/sendCommitPrompt\(\{\s*followUps,/);
    expect(src).not.toMatch(/claimPiece\(coachingSessionId, 'commit_prompt'\)/);
  });

  test('the free-form session-complete line is skipped when the report went as the template', () => {
    expect(src).toMatch(/if \(followUps && !completionAnnounced\)/);
  });
});
