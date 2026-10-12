/**
 * /portal for an account that is portal-activated but has no password saved (bd-kkpg4t).
 *
 * The July 2026 migration left 3,350 production accounts with portal_activated = true and
 * portal_password_hash NULL. /portal looked only at the flag, so it told them "already active,
 * log in with the password you created" — a password they never created. With no password
 * saved she needs the set-up link, same as a teacher who was never activated.
 */
jest.mock('../../shared/services/portal-invite.service', () => ({
  sendPortalInvite: jest.fn().mockResolvedValue({ success: true, token: 't', expiresAt: new Date() }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/config/branding', () => ({ portalUrl: () => 'https://portal.example' }));

const PortalInviteService = require('../../shared/services/portal-invite.service');
const { handlePortalCommand } = require('../../shared/handlers/portal-command.handler');

const user = (over) => ({ id: 'u-1', preferred_language: 'en', ...over });

beforeEach(() => PortalInviteService.sendPortalInvite.mockClear());

describe('/portal', () => {
  it('activated with NO password: sends the set-up invite, not the login link', async () => {
    const reply = await handlePortalCommand(user({ portal_activated: true, portal_password_hash: null }), '923000000000');
    expect(PortalInviteService.sendPortalInvite).toHaveBeenCalledWith('u-1', '923000000000', 'en');
    expect(reply).toBe('');
  });

  it('activated WITH a password: still sends the login link', async () => {
    const reply = await handlePortalCommand(user({ portal_activated: true, portal_password_hash: '$2a$10$x' }), '923000000000');
    expect(PortalInviteService.sendPortalInvite).not.toHaveBeenCalled();
    expect(reply).toMatch(/portal\/login/);
  });

  it('never activated: sends the set-up invite (unchanged)', async () => {
    await handlePortalCommand(user({ portal_activated: false, portal_password_hash: null }), '923000000000');
    expect(PortalInviteService.sendPortalInvite).toHaveBeenCalled();
  });
});
