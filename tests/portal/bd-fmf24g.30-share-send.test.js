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
 *
 * bd-fmf24g.43 — the share builds its own message for all four kinds (infrastructure/templates/share/): the file in the
 * header, one or two short lines, no button and no link token. It needs NONE of the ready-notice modules
 * (portal-ready-templates, portal-ready-whatsapp.service) or the area-link signer (portal-link-token): each is mocked
 * below to throw on load, which is what a branch without them (main) does.
 */

const mockSupabaseCalls = [];
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => { mockSupabaseCalls.push(a); throw new Error('no db in this test'); } }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendTemplate: jest.fn() }));
jest.mock('../../bot/shared/services/portal-ready-templates', () => { throw new Error('portal-ready-templates is not on this branch'); }, { virtual: true });
jest.mock('../../bot/shared/services/portal-ready-whatsapp.service', () => { throw new Error('portal-ready-whatsapp is not on this branch'); }, { virtual: true });
jest.mock('../../bot/shared/services/portal-link-token', () => { throw new Error('portal-link-token is not on this branch'); }, { virtual: true });
jest.mock('../../bot/shared/services/assessment/assessment-browse.service', () => ({ listChapters: jest.fn(async () => []) }));

const fs = require('fs');
const path = require('path');
const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');
const Share = require('../../bot/shared/services/share-send.service');

const FSI = '⁨';
const PDI = '⁩';
const USER = { id: 'u1', phone_number: '923001112222', preferred_language: 'en' };
const PAPER = {
  kind: 'paper', itemRef: 'paper:r1', title: 'Plants and food', chapter: 3, grade: 4, subject: 'Science', questions: 15, pdfUrl: 'https://r2.example/p.pdf',
};
const LESSON = {
  kind: 'lesson', itemRef: 'lesson:seg1:en', title: 'Transport of Water in Plants', grade: 7, subject: 'Science', pdfUrl: 'https://r2.example/l.pdf',
};
const DC = { kind: 'dc', itemRef: 'report:s1', title: 'Parts of a plant', grade: 4, subject: 'Science', imageUrl: 'https://r2.example/r.png' };

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    templateName: (kind) => ({
      paper: 'share_paper_v1', lesson: 'share_lesson_plan_v1', dc: 'share_dc_report_v1', observation: 'share_observation_report_v1',
    })[kind] || null,
    user: async () => USER,
    item: async () => PAPER,
    now: () => new Date('2026-10-10T10:42:00Z'),
    sendTemplate: async (to, name, lang, components, opts) => { calls.push({ to, name, lang, components }); return true; },
    ...over,
  };
}
const bodyOf = (components) => components.find((c) => c.type === 'body').parameters.map((p) => p.text);

describe('templateName: only what this deployment configures, never a default', () => {
  it('reads WHATSAPP_SHARE_TEMPLATE_<KIND> and nothing else', () => {
    expect(Share.templateNameFromEnv('paper', {})).toBeNull();
    expect(Share.templateNameFromEnv('paper', { WHATSAPP_SHARE_TEMPLATE_PAPER: ' share_paper_v1 ' })).toBe('share_paper_v1');
    // the portal-ready fallback's env (and its draft default names) do NOT switch the share send on
    expect(Share.templateNameFromEnv('paper', { PORTAL_READY_PAPER_TEMPLATE: 'paper_ready_v1' })).toBeNull();
    expect(Share.templateNameFromEnv('observation', { OBSERVE_REPORT_TEMPLATE: 'observation_report_sw' })).toBeNull();
  });
});

describe('availability', () => {
  it('is true only for a kind whose template is configured on THIS deployment', () => {
    expect(Share.availability({})).toEqual({ lesson: false, paper: false, dc: false, observation: false });
    expect(Share.availability({ WHATSAPP_SHARE_TEMPLATE_PAPER: 'share_paper_v1' })).toEqual({ lesson: false, paper: true, dc: false, observation: false });
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

  it('an item this send does not cover (a grades 1-5 lesson) → unavailable', async () => {
    const d = deps({ item: async () => ({ unsupported: 'lesson_source' }) });
    expect(await Share.sendShare({ userId: 'u1', kind: 'lesson', id: 'k5:1' }, d)).toEqual({ status: 'unavailable', reason: 'lesson_source' });
    expect(d.calls).toHaveLength(0);
  });

  it('a paper is sent with no link token and no ready-notice module: ONE template to HER number, the answer carries when', async () => {
    const d = deps();
    const out = await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    expect(out).toEqual({ status: 'sent', at: '2026-10-10T10:42:00.000Z' });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ to: '923001112222', name: 'share_paper_v1', lang: 'en' });
  });

  it('paper: the PDF in a document header with a file name; body title, grade, subject, question count; no button', async () => {
    const d = deps();
    await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    const c = d.calls[0].components;
    expect(c[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { link: 'https://r2.example/p.pdf', filename: 'Paper - Grade 4 Science - Plants and food.pdf' } }],
    });
    expect(bodyOf(c)).toEqual(['Plants and food', '4', 'Science', '15']);
    expect(c.map((x) => x.type)).toEqual(['header', 'body']);
  });

  it('lesson (grades 6-12): the PDF in a document header; body title, grade, subject; no button, no token', async () => {
    const d = deps({ item: async () => LESSON });
    expect((await Share.sendShare({ userId: 'u1', kind: 'lesson', id: 'g612:render1' }, d)).status).toBe('sent');
    const c = d.calls[0].components;
    expect(c[0].parameters[0]).toEqual({
      type: 'document', document: { link: 'https://r2.example/l.pdf', filename: 'Lesson plan - Grade 7 Science - Transport of Water in Plants.pdf' },
    });
    expect(bodyOf(c)).toEqual(['Transport of Water in Plants', '7', 'Science']);
    expect(c.map((x) => x.type)).toEqual(['header', 'body']);
    expect(d.calls[0].name).toBe('share_lesson_plan_v1');
  });

  it('a report (DC or observation) goes as an image-header template: topic, then the class line', async () => {
    for (const kind of ['dc', 'observation']) {
      const d = deps({ item: async () => ({ ...DC, kind }) });
      expect((await Share.sendShare({ userId: 'u1', kind, id: 's1' }, d)).status).toBe('sent');
      const c = d.calls[0].components;
      expect(c[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'https://r2.example/r.png' } }] });
      expect(bodyOf(c)).toEqual(['Parts of a plant', 'Grade 4 · Science']);
      expect(c.map((x) => x.type)).toEqual(['header', 'body']);
    }
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
});

describe('Urdu: the ur template, her words, and a Latin subject kept in its place', () => {
  const UR = { ...USER, preferred_language: 'ur' };

  it('a paper in Urdu isolates the Latin subject (else "Science · 15 سوال" reorders) and leaves the numbers plain', async () => {
    const d = deps({ user: async () => UR });
    await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);
    expect(d.calls[0].lang).toBe('ur');
    expect(bodyOf(d.calls[0].components)).toEqual(['Plants and food', '4', `${FSI}Science${PDI}`, '15']);
  });

  it('a report in Urdu names the class جماعت', async () => {
    const d = deps({ user: async () => UR, item: async () => DC });
    await Share.sendShare({ userId: 'u1', kind: 'dc', id: 's1' }, d);
    expect(bodyOf(d.calls[0].components)).toEqual(['Parts of a plant', 'جماعت 4 · Science']);
  });
});

describe('never "-": a missing title or class line falls back to a short label, in her language', () => {
  const cases = [
    ['paper with no chapter title', { ...PAPER, title: null }, ['Chapter 3', 'باب 3']],
    // the title closes line 1 inside *bold*: nothing follows it to reorder, so it is not isolated
    ['paper made from pages (no chapter)', { ...PAPER, title: null, chapter: null }, ['Science paper', 'Science کا پرچہ']],
    ['paper with neither chapter nor subject', { ...PAPER, title: null, chapter: null, subject: null }, ['Paper', 'پرچہ']],
    ['lesson with no title', { ...LESSON, title: null }, ['Lesson plan', 'لیسن پلان']],
    ['DC report with no topic', { ...DC, title: null }, ['DC observation', 'ڈیجیٹل کوچنگ مشاہدہ']],
    ['observation report with no topic', { ...DC, kind: 'observation', title: null }, ['Observation', 'مشاہدہ']],
  ];
  it.each(cases)('%s', (_, item, [en, ur]) => {
    expect(bodyOf(Share.componentsFor(item, { lang: 'en' }))[0]).toBe(en);
    expect(bodyOf(Share.componentsFor(item, { lang: 'ur' }))[0]).toBe(ur);
  });

  it('a report with neither grade nor subject reads "Your class" / "آپ کی کلاس"', () => {
    const bare = { ...DC, grade: null, subject: null };
    expect(bodyOf(Share.componentsFor(bare, { lang: 'en' }))[1]).toBe('Your');
    expect(bodyOf(Share.componentsFor(bare, { lang: 'ur' }))[1]).toBe('آپ');
  });

  it('no body parameter is ever "-" or empty, and none carries a newline or a tab (Meta rejects it)', () => {
    // Every case above, except a paper with no subject: subject_code is NOT NULL, so that one exists only to pin the
    // title's last fallback. A report's grade and subject come from free JSON and may both be missing.
    const items = [...cases.filter(([name]) => !/nor subject/.test(name)).map(([, item]) => item),
      { ...DC, grade: null, subject: null }, { ...PAPER, title: 'Line one\nline\ttwo' }];
    for (const item of items) {
      for (const lang of ['en', 'ur']) {
        for (const t of bodyOf(Share.componentsFor(item, { lang }))) {
          expect(t).not.toBe('-');
          expect(t.trim()).not.toBe('');
          expect(t).not.toMatch(/[\n\t]| {4}/);
        }
      }
    }
  });
});

describe('the paper resolver names the paper from data on every branch (the textbook chapter title)', () => {
  const row = {
    id: 'r1', grade_code: 'grade_4', subject_code: 'science', chapter_number: 3, question_count: 15,
    assessment_papers: [{ status: 'ready', file_r2_key: 'papers/r1.pdf', question_count: 14 }],
  };
  const db = (data) => ({
    from: () => {
      const c = { select: () => c, eq: () => c, limit: () => c, maybeSingle: async () => ({ data, error: null }) };
      return c;
    },
  });
  const presign = async (k) => `https://signed.example/${k}`;

  it('chapter title from the book', async () => {
    Browse.listChapters.mockResolvedValueOnce([{ chapter_number: 2, chapter_title: 'Other' }, { chapter_number: 3, chapter_title: 'Plants and food' }]);
    const item = await Share.itemResolvers(db(row), { presign }).paper('u1', 'r1');
    expect(Browse.listChapters).toHaveBeenLastCalledWith(4, 'science');
    expect(item).toMatchObject({
      kind: 'paper', itemRef: 'paper:r1', title: 'Plants and food', chapter: 3, grade: 4, subject: 'Science', questions: 14,
      pdfUrl: 'https://signed.example/papers/r1.pdf',
    });
  });

  it('the book lookup failing still sends: the title falls back to the chapter number', async () => {
    Browse.listChapters.mockRejectedValueOnce(new Error('db down'));
    const item = await Share.itemResolvers(db(row), { presign }).paper('u1', 'r1');
    expect(item.title).toBeNull();
    expect(bodyOf(Share.componentsFor(item, { lang: 'en' }))[0]).toBe('Chapter 3');
  });

  it('a paper made from pages has no chapter to look up', async () => {
    Browse.listChapters.mockClear();
    const item = await Share.itemResolvers(db({ ...row, chapter_number: null }), { presign }).paper('u1', 'r1');
    expect(Browse.listChapters).not.toHaveBeenCalled();
    expect(bodyOf(Share.componentsFor(item, { lang: 'en' }))[0]).toBe('Science paper');
  });
});

describe('the lesson resolver', () => {
  const db = (segments) => ({
    from: (table) => {
      const result = table === 'niete_lp612_deliveries'
        ? { data: [{ render_id: 'r9', segment_id: 'seg1', lang: 'ur', niete_lp612_renders: { status: 'ready', r2_key: 'lp/r9.pdf' } }], error: null }
        : segments;
      const c = { select: () => c, eq: () => c, limit: () => c, then: (res, rej) => Promise.resolve(result).then(res, rej) };
      return c;
    },
  });
  const presign = async (k) => `https://signed.example/${k}`;

  it('names the plan from its segment', async () => {
    const item = await Share.itemResolvers(db({ data: [{ subtopic_title: 'Transport of Water in Plants', menu_title: 'Water', grade: 7, subject: 'Science' }], error: null }), { presign })
      .lesson('u1', 'g612:r9');
    expect(item).toEqual({
      kind: 'lesson', itemRef: 'lesson:seg1:ur', title: 'Transport of Water in Plants', grade: 7, subject: 'Science', pdfUrl: 'https://signed.example/lp/r9.pdf',
    });
  });

  it('a segment read that fails is a failed send, not a nameless plan', async () => {
    const d = deps({ item: (kind, id, userId) => Share.itemResolvers(db({ data: null, error: { message: 'timeout' } }), { presign }).lesson(userId, id) });
    expect(await Share.sendShare({ userId: 'u1', kind: 'lesson', id: 'g612:r9' }, d)).toEqual({ status: 'failed', reason: 'error' });
    expect(d.calls).toHaveLength(0);
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

describe('the share needs nothing from the unreleased ready-notice work', () => {
  it('its source requires none of portal-ready-templates, portal-ready-whatsapp.service or portal-link-token', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/share-send.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/require\(/); // positive control: the stripped source still has its requires
    for (const mod of ['portal-ready-templates', 'portal-ready-whatsapp', 'portal-link-token']) expect(src).not.toContain(mod);
  });
});
