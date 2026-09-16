/**
 * bd-x4njf — a broadcast must be able to run against a template that is ALREADY
 * approved on the WABA, with that template's real variant list.
 *
 * bd-1zyqf taught the sender to honour each teacher's `preferred_language`,
 * clamped against the variants recorded in `filters.templateLanguages`. That is
 * necessary but not sufficient: nothing could WRITE a multi-language variant
 * list, because nothing could point a broadcast at a multi-language template in
 * the first place. The submit route always called createBroadcastTemplate(),
 * which DERIVES the name as `broadcast_<uuid>` and submits a brand-new
 * single-language template built from the body the operator typed.
 *
 * So `niete_lp612_launch_v1` — approved on the production WABA in BOTH `en` and
 * `ur` — was unreachable from the only send path that persists a wamid, and a
 * send through the dashboard would have delivered English to 496 of 500
 * Urdu-preferring teachers even with bd-1zyqf deployed.
 *
 * WHY THE VARIANT LIST IS FETCHED, NOT DECLARED: an operator-typed list that is
 * wrong is undetectable until the send, where Meta hard-fails every message with
 * error 132001 ("template name does not exist in the language") rather than
 * falling back. Meta is the only authority on what variants exist, so the route
 * asks it. This is CLAUDE.md rule 16 — defined is not working; verify against
 * the live artifact.
 *
 * The lookup is also an APPROVAL gate, not just a language lookup: a PENDING or
 * REJECTED variant is not sendable, so it must never enter the pool.
 */

const path = require('path');
const fs = require('fs');

// The literal is repeated rather than held in a const: babel-jest hoists
// jest.mock() above every declaration in the file, so a const path is not yet
// initialised when the factory is registered.
jest.mock('../../dashboard/database/queries', () => ({
  getBroadcastById: jest.fn(),
  updateBroadcastLog: jest.fn(() => Promise.resolve()),
  getUsersForBroadcast: jest.fn(() => Promise.resolve([])),
  insertBroadcastMessages: jest.fn(() => Promise.resolve()),
  updateBroadcastMessage: jest.fn(() => Promise.resolve()),
  getPendingBroadcastMessages: jest.fn(() => Promise.resolve([])),
  getInterruptedBroadcasts: jest.fn(() => Promise.resolve([])),
}));

const axios = require('axios');
const queries = require('../../dashboard/database/queries');
const broadcastService = require('../../dashboard/services/whatsapp-broadcast.service');

const TEMPLATE = 'niete_lp612_launch_v1';
const BROADCAST_ID = 'bcast-x4njf-0001';

/** A Meta message_templates list response. */
function metaList(...templates) {
  return Promise.resolve({ data: { data: templates } });
}

function variant(language, status = 'APPROVED', name = TEMPLATE) {
  return { id: `id-${name}-${language}`, name, language, status };
}

/** Every language code this run put on the Graph API wire, in send order. */
function sentLanguageCodes() {
  return axios.post.mock.calls
    .filter(([url]) => /\/messages$/.test(url))
    .map(([, body]) => body.template?.language?.code);
}

function okSend(wamid = 'wamid.TEST') {
  return Promise.resolve({ data: { messages: [{ id: wamid }] } });
}

/** Stage a broadcast row whose template variants came from the Meta lookup. */
function cohort(users, templateLanguages) {
  queries.getBroadcastById.mockResolvedValue({
    id: BROADCAST_ID,
    template_name: TEMPLATE,
    total_recipients: users.length,
    sent_count: 0,
    failed_count: 0,
    filters: { mode: 'search', templateLanguages },
  });
  queries.getUsersForBroadcast.mockResolvedValue(users);
}

function teacher(id, preferred_language) {
  return { id, phone_number: `9233450000${id}`, name: `T${id}`, preferred_language, last_message_at: null };
}

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockImplementation(() => okSend());
  axios.get.mockReset();
  axios.get.mockImplementation(() => metaList());
  Object.values(queries).forEach((fn) => fn.mockClear?.());
});

describe('getApprovedTemplateLanguages — asks Meta what variants exist', () => {
  test('queries the WABA message_templates endpoint for that template name', async () => {
    axios.get.mockImplementation(() => metaList(variant('en'), variant('ur')));

    await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, config] = axios.get.mock.calls[0];
    expect(url).toMatch(/\/message_templates$/);
    expect(config.params.name).toBe(TEMPLATE);
  });

  test('returns both languages when both are APPROVED', async () => {
    axios.get.mockImplementation(() => metaList(variant('ur'), variant('en')));

    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(langs.sort()).toEqual(['en', 'ur']);
  });

  test('puts the default language first so the fallback is deterministic', async () => {
    axios.get.mockImplementation(() => metaList(variant('ur'), variant('en')));

    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(langs[0]).toBe(broadcastService.TEMPLATE_LANGUAGE_DEFAULT);
  });

  test.each(['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL'])(
    'drops a %s variant — it is not sendable',
    async (status) => {
      axios.get.mockImplementation(() => metaList(variant('en'), variant('ur', status)));

      const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

      expect(langs).toEqual(['en']);
    }
  );

  test('ignores a different template that a loose name match returned', async () => {
    axios.get.mockImplementation(() =>
      metaList(variant('en'), variant('ur', 'APPROVED', `${TEMPLATE}_v2`))
    );

    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(langs).toEqual(['en']);
  });

  test('drops an approved variant whose language is outside the offer', async () => {
    axios.get.mockImplementation(() => metaList(variant('en'), variant('es')));

    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(langs).toEqual(['en']);
  });

  test('throws when the template has no approved variant at all', async () => {
    axios.get.mockImplementation(() => metaList(variant('en', 'REJECTED')));

    await expect(broadcastService.getApprovedTemplateLanguages(TEMPLATE)).rejects.toThrow(
      /no approved/i
    );
  });

  test('throws when Meta knows no such template', async () => {
    axios.get.mockImplementation(() => metaList());

    await expect(broadcastService.getApprovedTemplateLanguages(TEMPLATE)).rejects.toThrow(
      /no approved/i
    );
  });

  test("surfaces Meta's own error message when the lookup fails", async () => {
    axios.get.mockImplementation(() =>
      Promise.reject({ response: { data: { error: { message: 'Invalid OAuth access token' } } } })
    );

    await expect(broadcastService.getApprovedTemplateLanguages(TEMPLATE)).rejects.toThrow(
      /Invalid OAuth access token/
    );
  });

  test('never sends a message while merely looking a template up', async () => {
    axios.get.mockImplementation(() => metaList(variant('en'), variant('ur')));

    await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    expect(sentLanguageCodes()).toEqual([]);
  });
});

describe('the two halves compose — the lp612 cohort shape', () => {
  test('a bilingual approved template reaches each teacher in their own language', async () => {
    axios.get.mockImplementation(() => metaList(variant('en'), variant('ur')));
    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    cohort([teacher(1, 'ur'), teacher(2, 'en'), teacher(3, 'ur')], langs);
    await broadcastService.executeBroadcast(BROADCAST_ID);

    expect(sentLanguageCodes()).toEqual(['ur', 'en', 'ur']);
  });

  test('every message names the already-approved template, not a derived one', async () => {
    axios.get.mockImplementation(() => metaList(variant('en'), variant('ur')));
    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    cohort([teacher(1, 'ur')], langs);
    await broadcastService.executeBroadcast(BROADCAST_ID);

    const names = axios.post.mock.calls
      .filter(([url]) => /\/messages$/.test(url))
      .map(([, body]) => body.template?.name);
    expect(names).toEqual([TEMPLATE]);
    expect(names[0]).not.toMatch(/^broadcast_/);
  });

  test('a single-language approved template sends that language to everyone', async () => {
    axios.get.mockImplementation(() => metaList(variant('ur'), variant('en', 'PENDING')));
    const langs = await broadcastService.getApprovedTemplateLanguages(TEMPLATE);

    cohort([teacher(1, 'ur'), teacher(2, 'en')], langs);
    await broadcastService.executeBroadcast(BROADCAST_ID);

    // The `en` teacher gets `ur` rather than a 132001 failure: the resolver
    // intersects the preference with what the template actually has.
    expect(sentLanguageCodes()).toEqual(['ur', 'ur']);
  });
});

/** The submit route's own source, comments stripped. */
function submitRouteSource() {
  const abs = path.join(__dirname, '..', '..', 'dashboard', 'index.js');
  const code = fs.readFileSync(abs, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const start = code.indexOf("app.post('/observability/api/broadcast/submit'");
  expect(start).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.search(/\napp\.(get|post|put|delete)\(/);
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe('the submit route can actually be given an approved template', () => {
  test('reads a template name from the request body', () => {
    // Scoped to the req.body destructure on purpose: a bare /templateName/
    // already matched `template.templateName`, which createBroadcastTemplate
    // returns on the path this bead is routing AROUND.
    expect(submitRouteSource()).toMatch(/const\s*\{[^}]*\btemplateName\b[^}]*\}\s*=\s*req\.body/);
  });

  test('resolves that template\'s variants through the Meta lookup', () => {
    expect(submitRouteSource()).toMatch(/getApprovedTemplateLanguages/);
  });

  test('records the fetched variants, not the hardcoded single default', () => {
    const src = submitRouteSource();
    // The default is still correct for a template the dashboard creates itself,
    // so it stays reachable — but the value WRITTEN to the log must no longer be
    // that literal, or a bilingual template is recorded as English-only.
    // (An earlier version of this assertion used a negative lookahead after
    // `\s*`, which the zero-width match defeated; it passed on unfixed code.)
    expect(src).not.toMatch(/templateLanguages:\s*\[\s*broadcastService\.TEMPLATE_LANGUAGE_DEFAULT\s*\]/);
    expect(src).toMatch(/templateLanguages/);
  });

  test('does not submit a new template when one is already approved', () => {
    const src = submitRouteSource();
    const createIdx = src.indexOf('createBroadcastTemplate');
    expect(createIdx).toBeGreaterThan(-1);
    // The create call must be reachable only when no template name was given.
    expect(src.slice(0, createIdx)).toMatch(/if\s*\(\s*!?\s*approvedTemplate|templateName/);
  });
});

/**
 * The broadcast form's source. A route parameter no operator can reach is not a
 * fix — which is the same shape of defect as this bead itself, so it is pinned.
 */
function broadcastViewSource() {
  const abs = path.join(__dirname, '..', '..', 'dashboard', 'views', 'broadcast.ejs');
  return fs.readFileSync(abs, 'utf8');
}

describe('the operator can reach it from the broadcast form', () => {
  test('the form offers a template-name input', () => {
    expect(broadcastViewSource()).toMatch(/id="templateName"/);
  });

  test('the submit payload actually carries it to the route', () => {
    expect(broadcastViewSource()).toMatch(/templateName:\s*document\.getElementById\('templateName'\)/);
  });

  test('the confirm prompt does not promise approval when it sends immediately', () => {
    const src = broadcastViewSource();
    // An approved template sends at once. A prompt that still says "submit for
    // approval" would put 501 messages on the wire while the operator believed
    // they were queueing a Meta review.
    const confirms = src.match(/confirm\([^)]*\)/g) || [];
    const submitForApproval = confirms.filter((c) => /for approval/i.test(c));
    submitForApproval.forEach((c) => {
      // NOT `\?` as an alternative — that matched the prompt's own question
      // mark, so this assertion passed against the unconditional prompt.
      expect(c).toMatch(/templateName|approvedTemplate/);
    });
  });
});
