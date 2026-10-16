/**
 * bd-x7aprz.3 — /portal answers a registered adult with ONE button that opens the portal already
 * signed in: the signed /go link (bot/shared/services/app-login-link.js, 24 h, re-tappable).
 *
 * Until now /portal sent a 7-day set-up link (portal-invite.service) to anyone without a password,
 * and "log in with the password you created" to the rest. 170 teachers who registered on the form
 * let that link lapse and then met "No account found" on the portal. The number she messages from
 * is who she is; the link carries her user id, encrypted, and the portal turns it into a session.
 *
 * The network boundary (WhatsApp sends) is mocked; the handler and the signer are real.
 */
const ENV = { ...process.env };
let WhatsAppService;
let PortalInvite;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://sandboxref.supabase.co' };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example' }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendCtaUrl: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/portal-invite.service', () => ({
    sendPortalInvite: jest.fn().mockResolvedValue({ success: true, token: 't', expiresAt: new Date() }),
  }));
  WhatsAppService = require('../../bot/shared/services/whatsapp.service');
  PortalInvite = require('../../bot/shared/services/portal-invite.service');
});
afterAll(() => { process.env = ENV; });

// Digits built from parts: the public repo holds no phone-shaped literal (tests/setup/phone-shaped-fixtures).
const PHONE = ['92', '300', '0000001'].join('');
const registered = (over) => ({ id: '60530046-7ac3-4ea3-a976-b43c37c23213', name: 'Ayesha Khan', preferred_language: 'en', registration_completed: false, ...over });
const cp = (s) => [...String(s)].length;
const run = (user) => require('../../bot/shared/handlers/portal-command.handler').handlePortalCommand(user, PHONE);
const tokenIn = (url) => {
  const m = /^https:\/\/portal\.example\/go\/([A-Za-z0-9_-]+)$/.exec(url);
  return m ? m[1] : null;
};

describe('/portal for a registered adult', () => {
  it('sends ONE button whose link is her signed /go link to the app home, and no set-up link', async () => {
    const reply = await run(registered());
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, opts] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    const token = tokenIn(opts.url);
    expect(token).not.toBeNull();
    const payload = require('../../bot/shared/services/app-login-link').verifyAppLink(token);
    expect(payload).toEqual(expect.objectContaining({ u: registered().id, f: 'menu' }));
    expect(PortalInvite.sendPortalInvite).not.toHaveBeenCalled();
    expect(reply).toBe('');
    expect(JSON.stringify(WhatsAppService.sendCtaUrl.mock.calls)).not.toMatch(/portal\/setup/);
  });

  it('an account that already has a password gets the same link (no "use the password you created")', async () => {
    const reply = await run(registered({ portal_activated: true, portal_password_hash: '$2a$10$x' }));
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(reply).toBe('');
  });

  it('English: a short line and a button inside Meta\'s 20-code-point cap', async () => {
    await run(registered());
    const [, opts] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(opts.body).toMatch(/portal/i);
    expect(cp(opts.buttonText)).toBeGreaterThan(0);
    expect(cp(opts.buttonText)).toBeLessThanOrEqual(20);
    expect(cp(opts.body)).toBeLessThanOrEqual(1024);
  });

  it('Urdu for an Urdu teacher: body and button in Urdu, button inside the cap', async () => {
    await run(registered({ preferred_language: 'ur' }));
    const [, opts] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(opts.body).toMatch(/[؀-ۿ]/);
    expect(opts.buttonText).toMatch(/[؀-ۿ]/);
    expect(cp(opts.buttonText)).toBeLessThanOrEqual(20);
  });

  it('Meta refusing the button: the same link goes as text, once', async () => {
    WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
    const reply = await run(registered());
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(tokenIn((/https:\/\/\S+/.exec(text) || [''])[0])).not.toBeNull();
    expect(reply).toBe('');
  });

  it('no signing key on this deployment: a plain sorry, never a set-up link', async () => {
    delete process.env.INTERNAL_API_KEY;
    const reply = await run(registered());
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(PortalInvite.sendPortalInvite).not.toHaveBeenCalled();
    expect(reply).toBeTruthy();
    expect(reply).not.toMatch(/portal\/setup/);
  });
});

describe('/portal for someone not registered (the text handler routes them to the form first; this is the fail-safe)', () => {
  it('asks her to register and sends no link', async () => {
    const reply = await run({ id: 'u-2', name: null, registration_completed: false, preferred_language: 'en' });
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(PortalInvite.sendPortalInvite).not.toHaveBeenCalled();
    expect(reply).toMatch(/\/register/);
  });
});
