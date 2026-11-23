'use strict';
/**
 * bd-r2uzg1.2 — WhatsApp error 131052 (it could not hand us a file she sent) gets ONE reply a day, in her language.
 * ICT sheet HITL 183/185, DC 134: the bot only logged it, and she waited for a reply that never came.
 */
const fs = require('fs');
const path = require('path');
const svc = require('../../bot/shared/services/inbound-media-failed.service');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const statusOf = (code, details, phone = '923001234567') => ({
  id: 'wamid.X', status: 'failed', recipient_id: phone,
  errors: [{ code, title: 'Media download error', error_data: { details } }],
});

function deps({ claimed = true, user = { id: 'u1', preferred_language: 'en' }, sendOk = true } = {}) {
  const calls = { setNX: [], send: [], findUser: [] };
  return {
    calls,
    setNX: async (key, value, ttl) => { calls.setNX.push({ key, value, ttl }); return claimed; },
    findUser: async (phone) => { calls.findUser.push(phone); return user; },
    send: async (to, text) => { calls.send.push({ to, text }); return sendOk; },
  };
}

describe('a file WhatsApp could not hand us (131052)', () => {
  it('tells her once, in English, to send it again as a Document', async () => {
    const d = deps();
    const r = await svc.onFailedStatus(statusOf(131052, 'Incoming media file validation failed'), d);
    expect(r).toEqual(expect.objectContaining({ sent: true, key: 'inboundMediaResend' }));
    expect(d.calls.send).toHaveLength(1);
    expect(d.calls.send[0].to).toBe('923001234567');
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaResend.en);
    expect(d.calls.send[0].text).toMatch(/Document/);
  });

  it('answers in Urdu when that is her language', async () => {
    const d = deps({ user: { id: 'u2', preferred_language: 'ur' } });
    await svc.onFailedStatus(statusOf(131052, 'Incoming media file validation failed'), d);
    expect(d.calls.send[0].text).toContain('ڈاکیومنٹ');
  });

  it('says the file is too big instead, when WhatsApp says so (a Document would fail the same way)', async () => {
    const d = deps();
    const r = await svc.onFailedStatus(
      statusOf(131052, 'Media file size too big 122.025276MB. Max file size we currently support: 100MB.'), d);
    expect(r.key).toBe('inboundMediaTooBig');
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaTooBig.en);
  });

  it('says nothing a second time inside the day', async () => {
    const d = deps({ claimed: false });
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(r).toEqual(expect.objectContaining({ sent: false, reason: 'already_told_today' }));
    expect(d.calls.send).toHaveLength(0);
  });

  it('claims one key per sender for 24 hours, whatever the number format', async () => {
    const d = deps();
    await svc.onFailedStatus(statusOf(131052, 'x', '+923001234567'), d);
    expect(d.calls.setNX[0].key).toBe('inbound_media_failed_notice:923001234567');
    expect(d.calls.setNX[0].ttl).toBe(24 * 60 * 60);
  });

  it('answers a sender with no account in English, the catalog floor', async () => {
    const d = deps({ user: null });
    await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(d.calls.send).toHaveLength(1);
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaResend.en);
  });

  it('ignores every other failure code', async () => {
    for (const code of [131047, 131026, 100, 131053]) {
      const d = deps();
      const r = await svc.onFailedStatus(statusOf(code, 'x'), d);
      expect(r.sent).toBe(false);
      expect(d.calls.send).toHaveLength(0);
      expect(d.calls.setNX).toHaveLength(0);
    }
  });

  it('never throws, even when the lookup or the send fails', async () => {
    const d = deps();
    d.findUser = async () => { throw new Error('db down'); };
    await expect(svc.onFailedStatus(statusOf(131052, 'x'), d)).resolves.toEqual(expect.objectContaining({ sent: false }));
    await expect(svc.onFailedStatus(null, deps())).resolves.toEqual(expect.objectContaining({ sent: false }));
  });
});

describe('the strings', () => {
  it('exist in English and Urdu and fit a WhatsApp body', () => {
    for (const key of ['inboundMediaResend', 'inboundMediaTooBig']) {
      expect(UX_STRINGS[key]).toBeDefined();
      for (const lang of ['en', 'ur']) {
        expect(typeof UX_STRINGS[key][lang]).toBe('string');
        expect([...UX_STRINGS[key][lang]].length).toBeLessThanOrEqual(1024);
      }
    }
  });
});

describe('the webhook', () => {
  it('hands every failed status receipt to the service', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const failedBlock = src.slice(src.indexOf("if (newStatus === 'failed')"));
    expect(src.indexOf("if (newStatus === 'failed')")).toBeGreaterThan(-1);
    expect(failedBlock.slice(0, 3000)).toMatch(
      /require\('\.\/shared\/services\/inbound-media-failed\.service'\)\.onFailedStatus\(status\)/);
  });
});

/**
 * bd-f3b562 (queue #233, 23 Nov) — a coach in the middle of an observation hears it EVERY time WhatsApp refuses her
 * recording, in words for that step. On prod a coach armed for her debrief sent the recording 6 times (13:32-16:36
 * PKT); Meta refused each (131052) and the once-a-day rule answered only the first, so the debrief looked stuck.
 */
describe('a coach mid-observation (armed for a recording)', () => {
  function obsDeps({ step = { state: 'awaiting_debrief_audio', sessionId: 's1' }, claimed = {}, user } = {}) {
    const d = deps(user === undefined ? {} : { user });
    d.setNX = async (key, value, ttl) => {
      d.calls.setNX.push({ key, value, ttl });
      return Object.prototype.hasOwnProperty.call(claimed, key) ? claimed[key] : true;
    };
    d.getObserveState = async () => step;
    return d;
  }
  const DAILY = 'inbound_media_failed_notice:923001234567';
  const BURST = 'inbound_media_failed_notice:923001234567:observe';

  it('tells her the debrief recording did not arrive, that the visit waits, and how to resend', async () => {
    const d = obsDeps();
    const r = await svc.onFailedStatus(statusOf(131052, 'Incoming media file validation failed'), d);
    expect(r).toEqual(expect.objectContaining({ sent: true, key: 'inboundMediaObserveDebrief' }));
    expect(d.calls.send).toHaveLength(1);
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaObserveDebrief.en);
    expect(d.calls.send[0].text).toMatch(/debrief/i);
    expect(d.calls.send[0].text).toMatch(/Document/);
  });

  it('still tells her after the daily notice was already sent (each refused file gets an answer)', async () => {
    const d = obsDeps({ claimed: { [DAILY]: false } });
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(r.sent).toBe(true);
    expect(d.calls.setNX.map((c) => c.key)).not.toContain(DAILY);
  });

  it('claims a short burst key, so two files refused together are answered once', async () => {
    const d = obsDeps();
    await svc.onFailedStatus(statusOf(131052, 'x', '+923001234567'), d);
    expect(d.calls.setNX[0].key).toBe(BURST);
    expect(d.calls.setNX[0].ttl).toBe(svc.OBSERVE_BURST_SECONDS);
    expect(svc.OBSERVE_BURST_SECONDS).toBeLessThanOrEqual(5 * 60);

    const again = obsDeps({ claimed: { [BURST]: false } });
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), again);
    expect(r).toEqual(expect.objectContaining({ sent: false, reason: 'told_just_now' }));
    expect(again.calls.send).toHaveLength(0);
  });

  it('names the lesson recording when that is what the visit waits for', async () => {
    const d = obsDeps({ step: { state: 'awaiting_audio' } });
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(r.key).toBe('inboundMediaObserveLesson');
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaObserveLesson.en);
  });

  it('answers in Urdu when that is her language', async () => {
    const d = obsDeps({ user: { id: 'u2', preferred_language: 'ur' } });
    await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(d.calls.send[0].text).toBe(UX_STRINGS.inboundMediaObserveDebrief.ur);
  });

  it('keeps the too-big line when WhatsApp says the file is too big (a Document fails the same way)', async () => {
    const d = obsDeps();
    const r = await svc.onFailedStatus(statusOf(131052, 'Media file size too big 122MB. Max file size we currently support: 100MB.'), d);
    expect(r.key).toBe('inboundMediaTooBig');
    expect(d.calls.setNX[0].key).toBe(BURST);
  });

  it('any other state (or none) keeps the once-a-day notice', async () => {
    for (const step of [null, { state: 'awaiting_lesson_plan' }]) {
      const d = obsDeps({ step });
      const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
      expect(r.key).toBe('inboundMediaResend');
      expect(d.calls.setNX[0].key).toBe(DAILY);
      expect(d.calls.setNX[0].ttl).toBe(24 * 60 * 60);
    }
  });

  it('a failed state lookup falls back to the once-a-day notice, never throws', async () => {
    const d = obsDeps();
    d.getObserveState = async () => { throw new Error('redis down'); };
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(r).toEqual(expect.objectContaining({ sent: true, key: 'inboundMediaResend' }));
  });

  it('a sender with no account is never looked up for a step', async () => {
    const d = obsDeps({ user: null });
    let asked = false;
    d.getObserveState = async () => { asked = true; return { state: 'awaiting_debrief_audio' }; };
    const r = await svc.onFailedStatus(statusOf(131052, 'x'), d);
    expect(asked).toBe(false);
    expect(r.key).toBe('inboundMediaResend');
  });

  it('the production deps read the observe state', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/inbound-media-failed.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/getObserveState:[\s\S]{0,200}observe-state\.service/);
  });
});

describe('the observe strings', () => {
  it('exist in English and Urdu, fit a WhatsApp body, and isolate Latin words in the Urdu', () => {
    for (const key of ['inboundMediaObserveDebrief', 'inboundMediaObserveLesson']) {
      expect(UX_STRINGS[key]).toBeDefined();
      for (const lang of ['en', 'ur']) {
        expect(typeof UX_STRINGS[key][lang]).toBe('string');
        expect([...UX_STRINGS[key][lang]].length).toBeLessThanOrEqual(1024);
      }
      const ur = UX_STRINGS[key].ur;
      expect(ur).toMatch(/[؀-ۿ]/);
      for (const m of ur.matchAll(/[A-Za-z]+/g)) {
        const before = ur.slice(0, m.index);
        expect(before.lastIndexOf('⁦')).toBeGreaterThan(before.lastIndexOf('⁩'));
      }
    }
  });
});
