/**
 * /portal for an account with no password saved (bd-kkpg4t → bd-x7aprz.3).
 *
 * The July 2026 migration left 3,350 production accounts with portal_activated = true and
 * portal_password_hash NULL; /portal told them to "log in with the password you created". bd-kkpg4t sent
 * them the 7-day set-up link instead. bd-x7aprz.3 removes the password question altogether: every
 * registered adult gets the same one-tap signed /go link, password or not. The full contract lives in
 * tests/portal/portal-command-go-link.test.js; this pins the three account shapes bd-kkpg4t was about.
 */
jest.mock('../../shared/services/portal-invite.service', () => ({
  sendPortalInvite: jest.fn().mockResolvedValue({ success: true, token: 't', expiresAt: new Date() }),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendCtaUrl: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/config/branding', () => ({ portalUrl: () => 'https://portal.example' }));

process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test-project.supabase.co';

const PortalInviteService = require('../../shared/services/portal-invite.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { handlePortalCommand } = require('../../shared/handlers/portal-command.handler');

const user = (over) => ({ id: 'u-1', name: 'Rifat', preferred_language: 'en', ...over });

beforeEach(() => {
  PortalInviteService.sendPortalInvite.mockClear();
  WhatsAppService.sendCtaUrl.mockClear();
});

describe('/portal', () => {
  it.each([
    ['activated with NO password', { portal_activated: true, portal_password_hash: null }],
    ['activated WITH a password', { portal_activated: true, portal_password_hash: '$2a$10$x' }],
    ['never activated', { portal_activated: false, portal_password_hash: null }],
  ])('%s: the signed /go button, never the set-up link', async (_label, over) => {
    const reply = await handlePortalCommand(user(over), '923000000000');
    expect(PortalInviteService.sendPortalInvite).not.toHaveBeenCalled();
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendCtaUrl.mock.calls[0][1].url).toMatch(/^https:\/\/portal\.example\/go\/[A-Za-z0-9_-]+$/);
    expect(reply).toBe('');
  });
});
