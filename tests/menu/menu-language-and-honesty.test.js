'use strict';
/**
 * The /menu front door speaks the teacher's language, and stops advertising a
 * feature this deployment cannot run.
 *
 * Two defects, both at the SURFACE, both in the function that actually sends:
 *
 *  1. Every /menu rendered in English. `sendFeatureMenuListFallback(to, user)`
 *     took no language and every string in its payload was an English literal —
 *     header, body, footer, button, section title, and each row's title and
 *     description. Upstream looked localised and was not: `sendMenu` logged the
 *     language and passed it only to the Redis state blob and the text
 *     fallback. 9,205 feature-menu sends in 9 days on production, 1,060 of them
 *     logged `language: 'ur'`, and ALL 9,205 went out in English — for a cohort
 *     that is 99.0% `preferred_language='ur'`.
 *
 *  2. The body advertised reading assessments. Reading assessment has no Flow on
 *     this WABA, `isFeatureRunnable('reading')` is false, and it failed 57 times
 *     out of 57 before the row was removed. The row went; four other surfaces
 *     kept promising it.
 *
 * This suite drives the REAL sender and the REAL catalog, with only the network
 * boundary (global `fetch`, axios) mocked, because the whole defect lived
 * between the resolved language and the bytes on the wire — a source-level or
 * builder-level assertion would have passed throughout.
 *
 * Caps are measured in CODE POINTS, never `.length`: an 87-code-point bilingual
 * footer once took /language down silently for hours, and `.length` on Urdu and
 * emoji diverges from what Meta counts.
 */

const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { featureMenuRows } = require('../../bot/shared/config/role-features');

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
}));

const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

// WhatsApp Cloud API limits, in code points.
const CAPS = { header: 60, body: 1024, footer: 60, button: 20, rowTitle: 24, rowDesc: 72, sectionTitle: 24, rows: 10 };
const cp = (s) => [...s].length;
const URDU = /[؀-ۿ]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

// The three role shapes the deployment actually has, plus the unregistered
// default (253 live rows) that falls to DEFAULT_FEATURES.
const SHAPES = {
  teacher: { id: 'u-t', role: 'teacher' },
  principal: { id: 'u-p', role: 'principal' },
  coach: { id: 'u-c', role: 'coach' },
  unregistered: { id: 'u-u', role: 'unregistered' },
};

let sent;
beforeEach(() => {
  jest.clearAllMocks();
  sent = [];
  process.env.OBSERVE_MEWAKA_FLOW_ID = '1234567890';
  global.fetch = jest.fn(async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.test' }] }) };
  });
});

const send = async (user, language) => {
  const ok = await WhatsAppService.sendFeatureMenuListFallback('923330000001', user, language);
  return { ok, payload: sent[0], interactive: sent[0] && sent[0].interactive };
};

describe('the offer is real (else every assertion below is vacuous)', () => {
  test('LANGUAGE_OFFER carries more than one language', () => {
    expect(LANGUAGE_OFFER.length).toBeGreaterThan(1);
    expect(LANGUAGE_OFFER).toContain('ur');
  });
});

describe('the row builder holds structure, the catalog holds copy', () => {
  // Copy in role-features.js would be an unreviewed per-language map outside
  // the catalog — invisible to resolveUx, to the cap check, and to the language
  // audit's ratchet. The builder therefore emits KEYS.
  test('every row carries a catalog key for its title and description, and no literal copy', () => {
    for (const user of Object.values(SHAPES)) {
      const rows = featureMenuRows(user, { observeEnabled: true });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.titleKey).toBe('string');
        expect(typeof row.descriptionKey).toBe('string');
        expect(row.title).toBeUndefined();
        expect(row.description).toBeUndefined();
      }
    }
  });

  test('every key the builder can emit resolves in every offered language', () => {
    for (const user of Object.values(SHAPES)) {
      for (const row of featureMenuRows(user, { observeEnabled: true })) {
        for (const language of LANGUAGE_OFFER) {
          expect(resolveUx(row.titleKey, { language })).toBeTruthy();
          expect(resolveUx(row.descriptionKey, { language })).toBeTruthy();
        }
      }
    }
  });
});

describe('the chrome is bilingual', () => {
  test('Urdu: all five chrome fields come from the catalog', async () => {
    const { interactive } = await send(SHAPES.teacher, 'ur');
    expect(interactive.header.text).toBe(resolveUx('menuHeader', { language: 'ur' }));
    expect(interactive.body.text).toBe(resolveUx('menuBody', { language: 'ur' }));
    expect(interactive.footer.text).toBe(resolveUx('menuFooter', { language: 'ur' }));
    expect(interactive.action.button).toBe(resolveUx('menuButton', { language: 'ur' }));
    expect(interactive.action.sections[0].title).toBe(resolveUx('menuSectionTitle', { language: 'ur' }));
  });

  test('Urdu: the chrome is actually in Urdu script, not English in the ur slot', async () => {
    const { interactive } = await send(SHAPES.teacher, 'ur');
    for (const s of [interactive.header.text, interactive.body.text,
      interactive.footer.text, interactive.action.button,
      interactive.action.sections[0].title]) {
      expect(URDU.test(s)).toBe(true);
    }
  });

  test('English still works and is not Urdu', async () => {
    const { interactive } = await send(SHAPES.teacher, 'en');
    expect(interactive.header.text).toBe(resolveUx('menuHeader', { language: 'en' }));
    expect(URDU.test(interactive.header.text)).toBe(false);
  });

  test('a user object with no explicit language argument is served her preference', async () => {
    const { interactive } = await send({ id: 'u-x', role: 'teacher', preferred_language: 'ur' }, undefined);
    expect(URDU.test(interactive.header.text)).toBe(true);
  });
});

describe('the rows are bilingual, and their ids are not', () => {
  test('Urdu: every row title and description is the Urdu catalog value', async () => {
    const { interactive } = await send(SHAPES.principal, 'ur');
    const rows = interactive.action.sections[0].rows;
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      expect(URDU.test(row.title)).toBe(true);
      expect(URDU.test(row.description)).toBe(true);
    }
  });

  test('the reply ids stay ASCII — the router matches on them forever', async () => {
    for (const language of LANGUAGE_OFFER) {
      sent = [];
      const { interactive } = await send(SHAPES.principal, language);
      for (const row of interactive.action.sections[0].rows) {
        expect(row.id).toMatch(/^menu_[a-z_]+$/);
      }
    }
  });
});

describe('a dead feature is not advertised', () => {
  // Reading assessment cannot run here. It must not appear in the menu payload
  // in any language, for any role.
  test.each(Object.keys(SHAPES))('no reading assessment anywhere in the payload (%s)', async (shape) => {
    for (const language of LANGUAGE_OFFER) {
      sent = [];
      const { payload } = await send(SHAPES[shape], language);
      const json = JSON.stringify(payload);
      expect(json).not.toMatch(/reading/i);
      expect(json).not.toMatch(/ریڈنگ/);
      expect(json).not.toMatch(/پڑھائی/);
    }
  });

  test('the text menu fallback does not advertise it either', async () => {
    const MenuService = require('../../bot/shared/services/menu.service');
    const spy = jest.spyOn(WhatsAppService, 'sendMessage').mockResolvedValue(true);
    try {
      for (const language of LANGUAGE_OFFER) {
        spy.mockClear();
        await MenuService._sendTextMenuFallback('923330000001', 'u-1', 'sess-1', language);
        const text = spy.mock.calls[0][1];
        expect(text).not.toMatch(/reading/i);
        expect(text).not.toMatch(/ریڈنگ/);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("the assistant's own capability block does not promise it", () => {
    const OpenAIService = require('../../bot/shared/services/openai.service');
    for (const language of LANGUAGE_OFFER) {
      for (const tags of [false, true]) {
        const block = OpenAIService._getCapabilitiesSection(language, tags);
        expect(block).not.toMatch(/reading/i);
        expect(block).not.toMatch(/ریڈنگ/);
      }
      for (const format of ['text', 'voice']) {
        const prompt = OpenAIService._getFormatAwareSystemPromptBase(format, language, 'Riffat');
        expect(prompt).not.toMatch(/reading assessment/i);
        expect(prompt).not.toMatch(/\/reading test/i);
      }
    }
  });
});

describe('field caps, in code points, for every offered language and role', () => {
  test.each(Object.keys(SHAPES))('%s fits every WhatsApp limit in both languages', async (shape) => {
    for (const language of LANGUAGE_OFFER) {
      sent = [];
      const { interactive } = await send(SHAPES[shape], language);
      const section = interactive.action.sections[0];
      expect(cp(interactive.header.text)).toBeLessThanOrEqual(CAPS.header);
      expect(cp(interactive.body.text)).toBeLessThanOrEqual(CAPS.body);
      expect(cp(interactive.footer.text)).toBeLessThanOrEqual(CAPS.footer);
      expect(cp(interactive.action.button)).toBeLessThanOrEqual(CAPS.button);
      expect(cp(section.title)).toBeLessThanOrEqual(CAPS.sectionTitle);
      expect(section.rows.length).toBeLessThanOrEqual(CAPS.rows);
      for (const row of section.rows) {
        expect(cp(row.title)).toBeLessThanOrEqual(CAPS.rowTitle);
        expect(cp(row.description)).toBeLessThanOrEqual(CAPS.rowDesc);
      }
    }
  });
});

describe('the row-count guard is capable of failing', () => {
  // Meta rejects a list with more than 10 rows outright, and the teacher
  // receives nothing. A role-aware builder is exactly the thing that grows to
  // 11 rows one day, so the sender refuses and says so at error level — an
  // info-level line for a send that reached nobody is how /language stayed
  // silent for hours.
  test('11 rows is refused, and logged at error', async () => {
    // isolateModules, not resetModules: the outer WhatsAppService and the
    // axios stub other tests hold must keep pointing at the same instances.
    let WA;
    let log;
    jest.isolateModules(() => {
      jest.doMock('../../bot/shared/config/role-features', () => ({
        canSelfCoach: () => true,
        canObserve: () => true,
        featuresFor: () => ({ dc: true, observe: true }),
        featureMenuRows: () => Array.from({ length: 11 }, (_, i) => ({
          id: `menu_x${i}`, titleKey: 'menuRowOtherTitle', descriptionKey: 'menuRowOtherDesc',
        })),
      }));
      // The logger this isolated copy of the service will actually call.
      log = require('../../bot/shared/utils/logger').logToFile;
      WA = require('../../bot/shared/services/whatsapp.service');
    });

    const ok = await WA.sendFeatureMenuListFallback('923330000001', SHAPES.teacher, 'ur');
    expect(ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    const levels = log.mock.calls.map((c) => c[2]);
    expect(levels).toContain('error');
  });
});

describe('a rejected menu send is an error, not an info line', () => {
  test('Meta rejecting the payload logs at error level', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Footer text length invalid', code: 131009 } }),
    }));
    const ok = await WhatsAppService.sendFeatureMenuListFallback('923330000001', SHAPES.teacher, 'ur');
    expect(ok).toBe(false);
    expect(logToFile.mock.calls.map((c) => c[2])).toContain('error');
  });
});

describe('button titles are clipped in code points, not UTF-16 units', () => {
  // `.substring(0, 20)` counts UTF-16 units, so a title whose 20th code point is
  // an astral character is cut mid-surrogate — a title that passes locally and
  // is mangled or rejected at Meta.
  test('a 20-code-point clip never leaves a lone surrogate', async () => {
    const axios = require('axios');
    axios.post.mockClear();
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.b' }] }, status: 200 });

    const title = `${'کوچنگ رپورٹ دیکھیں'}🎓🎓🎓`; // > 20 code points, astral tail
    expect(cp(title)).toBeGreaterThan(CAPS.button);

    await WhatsAppService.sendInteractiveButtons('923330000001', {
      body: 'body',
      buttons: [{ id: 'b1', title }],
    });

    const sentTitle = axios.post.mock.calls[0][1].interactive.action.buttons[0].reply.title;
    expect(cp(sentTitle)).toBeLessThanOrEqual(CAPS.button);
    expect(LONE_SURROGATE.test(sentTitle)).toBe(false);
    expect(sentTitle).toBe([...title].slice(0, CAPS.button).join(''));
  });
});
