'use strict';
/**
 * bd-fmf24g.30 — the share route's service: "Send on WhatsApp" from a portal screen, TEMPLATE ONLY, with the REAL result.
 * Nothing here sends: the WhatsApp send is injected.
 *
 *   unavailable  no template named for that kind on THIS deployment (env), Meta says it does not exist / is paused,
 *                or the item is of a kind this send does not cover. The app shows "Not available yet".
 *   failed       Meta refused for any other reason (retry may work).
 *   sent         Meta accepted it.
 *   not_found    not her item (ownership is the query, never the request body).
 */

const mockSupabaseCalls = [];
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => { mockSupabaseCalls.push(a); throw new Error('no db in this test'); } }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendTemplate: jest.fn() }));

const Share = require('../../bot/shared/services/share-send.service');

const USER = { id: 'u1', phone_number: '923001112222', preferred_language: 'ur' };
const PAPER = {
  kind: 'paper', itemRef: 'paper:r1', title: 'Plants and food', grade: 4, subject: 'Science', questions: 15, pdfUrl: 'https://r2.example/p.pdf', lang: 'ur',
};

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    templateName: (kind) => ({ paper: 'paper_ready_v1', lesson: 'lesson_plan_ready_v1', dc: 'report_ready_v1', observation: 'report_ready_v1' })[kind] || null,
    user: async () => USER,
    item: async () => PAPER,
    token: () => 'tok.sig',
    now: () => new Date('2026-10-10T10:42:00Z'),
    sendTemplate: async (to, name, lang, components, opts) => { calls.push({ to, name, lang, components }); return true; },
    ...over,
  };
}

describe('templateName: only what this deployment configures, never a default', () => {
  it('reads WHATSAPP_SHARE_TEMPLATE_<KIND> and nothing else', () => {
    expect(Share.templateNameFromEnv('paper', {})).toBeNull();
    expect(Share.templateNameFromEnv('paper', { WHATSAPP_SHARE_TEMPLATE_PAPER: ' paper_ready_v1 ' })).toBe('paper_ready_v1');
    // the portal-ready fallback's env (and its draft default names) do NOT switch the share send on
    expect(Share.templateNameFromEnv('paper', { PORTAL_READY_PAPER_TEMPLATE: 'paper_ready_v1' })).toBeNull();
    expect(Share.templateNameFromEnv('observation', { OBSERVE_REPORT_TEMPLATE: 'observation_report_sw' })).toBeNull();
  });
});

describe('availability', () => {
  it('is true only for a kind whose template is configured on THIS deployment', () => {
    expect(Share.availability({})).toEqual({ lesson: false, paper: false, dc: false, observation: false });
    expect(Share.availability({ WHATSAPP_SHARE_TEMPLATE_PAPER: 'paper_ready_v1' })).toEqual({ lesson: false, paper: true, dc: false, observation: false });
  });
});

describe('sendShare', () => {
  it('no template configured → unavailable, nothing looked up, nothing sent', async () => {
    const d = deps({ templateName: () => null, item: jest.fn(), user: jest.fn() });
    const out = await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    expect(out).toEqual({ status: 'unavailable', reason: 'not_configured' });
    expect(d.item).not.toHaveBeenCalled();
    expect(d.calls).toHaveLength(0);
  });

  it('an unknown kind is a bad request', async () => {
    expect((await Share.sendShare({ userId: 'u1', kind: 'video', id: 'x' }, deps())).status).toBe('bad_request');
    expect((await Share.sendShare({ userId: '', kind: 'paper', id: 'x' }, deps())).status).toBe('bad_request');
    expect((await Share.sendShare({ userId: 'u1', kind: 'paper', id: '' }, deps())).status).toBe('bad_request');
  });

  it('not her item → not_found, nothing sent', async () => {
    const d = deps({ item: async () => null });
    expect(await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d)).toEqual({ status: 'not_found' });
    expect(d.calls).toHaveLength(0);
  });

  it('an item this send does not cover → unavailable', async () => {
    const d = deps({ item: async () => ({ unsupported: 'lesson_source' }) });
    expect(await Share.sendShare({ userId: 'u1', kind: 'lesson', id: 'k5:1' }, d)).toEqual({ status: 'unavailable', reason: 'lesson_source' });
  });

  it('sent: ONE template to HER number, in HER language, with the configured name; the answer carries when', async () => {
    const d = deps();
    const out = await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    expect(out).toEqual({ status: 'sent', at: '2026-10-10T10:42:00.000Z' });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ to: '923001112222', name: 'paper_ready_v1', lang: 'ur' });
    const body = d.calls[0].components.find((c) => c.type === 'body').parameters.map((p) => p.text);
    expect(body).toEqual(['Plants and food', '4', 'Science', '15']);
    expect(d.calls[0].components.find((c) => c.type === 'button').parameters[0].text).toBe('tok.sig');
  });

  it('an English teacher gets the en template; an unknown language falls to en', async () => {
    const d = deps({ user: async () => ({ ...USER, preferred_language: 'fr' }) });
    await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    expect(d.calls[0].lang).toBe('en');
  });

  it('Meta: template does not exist / paused / disabled → unavailable (not failed)', async () => {
    for (const code of [132001, 132015, 132016]) {
      const d = deps({ sendTemplate: async (a, b, c, e, opts) => { opts.report.code = code; return false; } });
      expect(await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d)).toEqual({ status: 'unavailable', reason: 'template_missing' });
    }
  });

  it('Meta refuses for any other reason → failed, and it is the REAL result (never "sent")', async () => {
    const d = deps({ sendTemplate: async (a, b, c, e, opts) => { opts.report.code = 131026; return false; } });
    expect(await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d)).toEqual({ status: 'failed', reason: 'refused' });
    const d2 = deps({ sendTemplate: async () => { throw new Error('boom'); } });
    expect(await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d2)).toEqual({ status: 'failed', reason: 'error' });
  });

  it('no phone on her row → unavailable', async () => {
    const d = deps({ user: async () => ({ ...USER, phone_number: null }) });
    expect((await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d)).status).toBe('unavailable');
  });

  it('a report (DC or observation) goes as an image-header template with its title', async () => {
    const d = deps({ item: async () => ({ kind: 'dc', title: 'Parts of a plant', line: 'Grade 4 · Science', imageUrl: 'https://r2.example/r.png', lang: 'en' }) });
    const out = await Share.sendShare({ userId: 'u1', kind: 'dc', id: 's1' }, d);
    expect(out.status).toBe('sent');
    const c = d.calls[0].components;
    expect(c[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'https://r2.example/r.png' } }] });
    expect(c.find((x) => x.type === 'body').parameters.map((p) => p.text)).toEqual(['Parts of a plant', 'Grade 4 · Science']);
  });
});

describe('the item queries are scoped to HER (ownership is the query)', () => {
  it('the paper, lesson and session lookups filter on user_id', async () => {
    const seen = [];
    const chain = (table) => {
      const c = {
        select: () => c, in: () => c, limit: () => c, is: () => c, order: () => c,
        eq: (col, val) => { seen.push([table, col, val]); return c; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return c;
    };
    const items = Share.itemResolvers({ from: chain });
    await items.paper('u1', 'r1'); await items.lesson('u1', 'g612:render1'); await items.dc('u1', 's1'); await items.observation('u1', 's2');
    for (const t of ['assessment_requests', 'niete_lp612_deliveries', 'coaching_sessions']) {
      expect(seen).toContainEqual([t, 'user_id', 'u1']);
    }
  });
});
