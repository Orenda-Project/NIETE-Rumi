/**
 * bd-1zyqf — a broadcast must reach each teacher in the language THEY prefer.
 *
 * The send hardcoded `language: { code: 'en' }` in sendTemplateMessage, and the
 * recipient lookups never selected `preferred_language` at all, so the column
 * was not even in memory at send time. On the Grades 6-12 LP cohort that means
 * 496 of 500 Urdu-preferring teachers would have received the English template.
 *
 * Both halves are load-bearing and this suite covers both:
 *   1. BEHAVIOUR — the resolved code that reaches the Graph API per recipient.
 *   2. DATA — the recipient selects actually fetch `preferred_language`. Without
 *      this, every behaviour test here still passes while production sends
 *      English to everyone, because `user.preferred_language` is undefined.
 *
 * Two rules from the language-protocol skill (CLAUDE.md rule 20) are encoded:
 *
 *   - Enforcement lives INSIDE the sender, not at its callers. "Enforcement a
 *     caller can forget is not enforcement" — so a caller handing over a
 *     language outside the offer must not be able to put it on the wire.
 *   - Teacher-addressed text reads the CURRENT preference at send time, which is
 *     why the resume path re-reads the teacher's row rather than replaying a
 *     language frozen into broadcast_messages at enqueue.
 *
 * NIETE is flat en/ur (`LANGUAGE_OFFER`), NOT region-keyed like the main bot.
 *
 * ON THE WIRE CODE: 'en', never 'en_US'. The registry's templateCodeFor('en')
 * returns 'en_US' because that is how the BOT's templates were approved on its
 * account — but this service creates its own templates with `language: 'en'`
 * (createBroadcastTemplate), and Meta hard-fails a send whose language does not
 * match an approved variant rather than falling back. Same conclusion bd-2469
 * reached for the password-reset OTP. The test at the bottom pins create and
 * send to the same namespace so nobody "tidies" one of them into the other.
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

/** Every language code this run put on the Graph API wire, in send order. */
function sentLanguageCodes() {
  return axios.post.mock.calls
    .filter(([url]) => /\/messages$/.test(url))
    .map(([, body]) => body.template?.language?.code);
}

/** The single language code from a one-message send. */
function sentLanguageCode() {
  const codes = sentLanguageCodes();
  return codes[codes.length - 1];
}

function okSend(wamid = 'wamid.TEST') {
  return Promise.resolve({ data: { messages: [{ id: wamid }] } });
}

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockImplementation(() => okSend());
  Object.values(queries).forEach((fn) => fn.mockClear?.());
  queries.updateBroadcastLog.mockResolvedValue(undefined);
  queries.insertBroadcastMessages.mockResolvedValue(undefined);
  queries.updateBroadcastMessage.mockResolvedValue(undefined);
});

describe('sendTemplateMessage — the recipient’s own language (bd-1zyqf)', () => {
  const TEMPLATE = 'niete_lp612_launch_v1';
  const BOTH = ['en', 'ur'];

  it('sends ur to a teacher who prefers ur', async () => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: 'ur',
      availableLanguages: BOTH,
    });

    expect(sentLanguageCode()).toBe('ur');
  });

  it('sends en to a teacher who prefers en', async () => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: 'en',
      availableLanguages: BOTH,
    });

    expect(sentLanguageCode()).toBe('en');
  });

  it('sends en_US to nobody — the wire code is our own, not the bot account’s', async () => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: 'en',
      availableLanguages: BOTH,
    });

    expect(sentLanguageCode()).not.toBe('en_US');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('falls back to the emergency floor when the preference is %s', async (_label, pref) => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: pref,
      availableLanguages: BOTH,
    });

    // DEFAULT_LANGUAGE — English, deliberately NOT offerDefaultLanguage() (ur).
    expect(sentLanguageCode()).toBe('en');
  });

  it.each([
    ['sw'],   // offered by the MAIN bot, never by NIETE
    ['hi'],
    ['fr'],
    ['ur-PK'],
    ['EN'],   // wrong case is not a member of the offer
  ])('never lets an unoffered code (%s) reach the Graph API', async (code) => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: code,
      availableLanguages: BOTH,
    });

    expect(sentLanguageCode()).toBe('en');
    expect(sentLanguageCodes()).not.toContain(code);
  });

  it.each([
    ['a number', 42],
    ['an object', { code: 'ur' }],
    ['an array', ['ur']],
  ])('clamps a non-string preference (%s) instead of sending it', async (_label, pref) => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: pref,
      availableLanguages: BOTH,
    });

    expect(sentLanguageCode()).toBe('en');
  });

  it('never asks for a variant the template does not have', async () => {
    // The dashboard's own dynamically-created templates exist in ONE language.
    // A ur teacher in such a broadcast must get the variant that exists, not a
    // hard failure from Meta (error 132001, "template name does not exist in
    // the language") which would fail 496 of 500 sends.
    await broadcastService.sendTemplateMessage('923001234567', 'broadcast_abc123', {
      preferredLanguage: 'ur',
      availableLanguages: ['en'],
    });

    expect(sentLanguageCode()).toBe('en');
  });

  it('honours a ur-only template for an en teacher', async () => {
    await broadcastService.sendTemplateMessage('923001234567', 'urdu_only_v1', {
      preferredLanguage: 'en',
      availableLanguages: ['ur'],
    });

    expect(sentLanguageCode()).toBe('ur');
  });

  it('ignores unoffered entries in the template’s language list', async () => {
    await broadcastService.sendTemplateMessage('923001234567', TEMPLATE, {
      preferredLanguage: 'ur',
      availableLanguages: ['sw', 'ur'],
    });

    expect(sentLanguageCode()).toBe('ur');
  });

  it('keeps the pre-bd-1zyqf default when a caller passes no options at all', async () => {
    // Backwards compatibility: every existing broadcast must go out byte-for-byte
    // as it does today rather than silently changing language on deploy.
    await broadcastService.sendTemplateMessage('923001234567', 'broadcast_abc123');

    expect(sentLanguageCode()).toBe('en');
  });

  it('still sends the template name and recipient unchanged', async () => {
    await broadcastService.sendTemplateMessage('923009999999', TEMPLATE, {
      preferredLanguage: 'ur',
      availableLanguages: BOTH,
    });

    const [, body] = axios.post.mock.calls[0];
    expect(body.to).toBe('923009999999');
    expect(body.template.name).toBe(TEMPLATE);
    expect(body.type).toBe('template');
  });
});

describe('executeBroadcast — per-recipient language across a cohort (bd-1zyqf)', () => {
  const BROADCAST_ID = 'b-1zyqf';

  // `templateLanguages: null` omits the key entirely, which is what every
  // broadcast created before bd-1zyqf looks like. A default parameter cannot
  // express that — passing undefined would just re-apply the default.
  function cohort(users, templateLanguages = ['en', 'ur']) {
    const filters = { mode: 'search' };
    if (templateLanguages !== null) filters.templateLanguages = templateLanguages;

    queries.getBroadcastById.mockResolvedValue({
      id: BROADCAST_ID,
      template_name: 'niete_lp612_launch_v1',
      total_recipients: users.length,
      sent_count: 0,
      failed_count: 0,
      filters,
    });
    queries.getUsersForBroadcast.mockResolvedValue(users);
  }

  it('gives every teacher their own language, not the first one’s', async () => {
    cohort([
      { id: 'u1', phone_number: '92300000001', preferred_language: 'ur', last_message_at: null },
      { id: 'u2', phone_number: '92300000002', preferred_language: 'en', last_message_at: null },
      { id: 'u3', phone_number: '92300000003', preferred_language: 'ur', last_message_at: null },
    ]);

    await broadcastService.executeBroadcast(BROADCAST_ID);

    expect(sentLanguageCodes()).toEqual(['ur', 'en', 'ur']);
  });

  it('is the shape of the real cohort: mostly ur, a few en', async () => {
    // 496 ur / 4 en, scaled down. The bug shipped one code for all of them.
    const users = [];
    for (let i = 0; i < 20; i++) {
      users.push({
        id: `u${i}`,
        phone_number: `9230000${String(i).padStart(4, '0')}`,
        preferred_language: i < 16 ? 'ur' : 'en',
        last_message_at: null,
      });
    }
    cohort(users);

    await broadcastService.executeBroadcast(BROADCAST_ID);

    const codes = sentLanguageCodes();
    expect(codes.filter((c) => c === 'ur')).toHaveLength(16);
    expect(codes.filter((c) => c === 'en')).toHaveLength(4);
  });

  it('floors a teacher with no recorded preference to en', async () => {
    cohort([
      { id: 'u1', phone_number: '92300000001', preferred_language: null, last_message_at: null },
      { id: 'u2', phone_number: '92300000002', last_message_at: null },
    ]);

    await broadcastService.executeBroadcast(BROADCAST_ID);

    expect(sentLanguageCodes()).toEqual(['en', 'en']);
  });

  it('sends the only existing variant when the broadcast’s template is single-language', async () => {
    cohort(
      [
        { id: 'u1', phone_number: '92300000001', preferred_language: 'ur', last_message_at: null },
        { id: 'u2', phone_number: '92300000002', preferred_language: 'en', last_message_at: null },
      ],
      ['en'],
    );

    await broadcastService.executeBroadcast(BROADCAST_ID);

    expect(sentLanguageCodes()).toEqual(['en', 'en']);
  });

  it('defaults to en when the broadcast records no template languages', async () => {
    // Every broadcast sent before bd-1zyqf has no templateLanguages in filters.
    cohort(
      [{ id: 'u1', phone_number: '92300000001', preferred_language: 'ur', last_message_at: null }],
      null,
    );

    await broadcastService.executeBroadcast(BROADCAST_ID);

    expect(sentLanguageCodes()).toEqual(['en']);
  });

  it('records the send against the right teacher regardless of language', async () => {
    cohort([
      { id: 'u1', phone_number: '92300000001', preferred_language: 'ur', last_message_at: null },
      { id: 'u2', phone_number: '92300000002', preferred_language: 'en', last_message_at: null },
    ]);

    await broadcastService.executeBroadcast(BROADCAST_ID);

    const sentIds = queries.updateBroadcastMessage.mock.calls
      .filter(([, , updates]) => updates.status === 'sent')
      .map(([, userId]) => userId);
    expect(sentIds).toEqual(['u1', 'u2']);
  });
});

describe('resumeBroadcast — reads the preference at send time (bd-1zyqf)', () => {
  const BROADCAST_ID = 'b-resume';

  beforeEach(() => {
    queries.getBroadcastById.mockResolvedValue({
      id: BROADCAST_ID,
      sent_count: 0,
      failed_count: 0,
      filters: { templateLanguages: ['en', 'ur'] },
    });
  });

  it('sends each pending message in that teacher’s language', async () => {
    await broadcastService.resumeBroadcast(
      BROADCAST_ID,
      'niete_lp612_launch_v1',
      [
        { id: 'm1', user_id: 'u1', phone_number: '92300000001', users: { preferred_language: 'ur' } },
        { id: 'm2', user_id: 'u2', phone_number: '92300000002', users: { preferred_language: 'en' } },
      ],
      { availableLanguages: ['en', 'ur'] },
    );

    expect(sentLanguageCodes()).toEqual(['ur', 'en']);
  });

  it('accepts the embedded user row as an array too', async () => {
    // PostgREST returns a to-one embed as an object, but the shape has bitten us
    // before when a relationship resolved as a collection. Handle both.
    await broadcastService.resumeBroadcast(
      BROADCAST_ID,
      'niete_lp612_launch_v1',
      [{ id: 'm1', user_id: 'u1', phone_number: '92300000001', users: [{ preferred_language: 'ur' }] }],
      { availableLanguages: ['en', 'ur'] },
    );

    expect(sentLanguageCodes()).toEqual(['ur']);
  });

  it('floors to en when the pending row carries no user language', async () => {
    await broadcastService.resumeBroadcast(
      BROADCAST_ID,
      'niete_lp612_launch_v1',
      [{ id: 'm1', user_id: 'u1', phone_number: '92300000001' }],
      { availableLanguages: ['en', 'ur'] },
    );

    expect(sentLanguageCodes()).toEqual(['en']);
  });

  it('still resumes with no options passed', async () => {
    await broadcastService.resumeBroadcast(BROADCAST_ID, 'broadcast_abc123', [
      { id: 'm1', user_id: 'u1', phone_number: '92300000001' },
    ]);

    expect(sentLanguageCodes()).toEqual(['en']);
  });
});

describe('the recipient lookups must FETCH preferred_language (bd-1zyqf)', () => {
  // Strip `//` comments so the bd-1zyqf notes explaining the column cannot
  // themselves satisfy a toContain(). Block comments are NOT stripped: a naive
  // /* ... */ regex matches a `/*` inside a string literal and deletes thousands
  // of lines of real code (learned on bd-ikkpf).
  function sourceWithoutLineComments(relPath) {
    const abs = path.join(__dirname, '..', '..', relPath);
    return fs.readFileSync(abs, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  }

  /**
   * A RECIPIENT select is one that pulls `last_message_at` alongside the phone
   * number: that column exists only to decide the 24h service window at send
   * time, so any query fetching it is on a send path and must also know the
   * teacher's language. Counting queries (getBroadcastUserCounts' bare
   * 'id, phone_number') are deliberately NOT included — they never send.
   *
   * Matching on the whole select string rather than a fixed column order means
   * this keeps working wherever preferred_language is added in the list.
   */
  function recipientSelects(relPath) {
    const code = sourceWithoutLineComments(relPath);
    return (code.match(/\.select\('[^']*'\)/g) || []).filter(
      (s) => s.includes('last_message_at') && s.includes('phone_number'),
    );
  }

  it('queries.js selects preferred_language everywhere it selects a recipient', () => {
    const selects = recipientSelects('dashboard/database/queries.js');

    expect(selects.length).toBeGreaterThanOrEqual(4);
    expect(selects.filter((s) => !s.includes('preferred_language'))).toEqual([]);
  });

  it('the search-mode lookup — the one the 500-teacher cohort uses — fetches it', () => {
    const code = sourceWithoutLineComments('dashboard/database/queries.js');
    const branch = code.indexOf("filters.mode === 'search' && filters.selectedUserIds");
    expect(branch).toBeGreaterThan(-1);

    // Bounded window: the branch body, not the rest of the file.
    const searchMode = code.slice(branch, branch + 900);
    expect(searchMode).toContain('preferred_language');
  });

  it('the index.js send route fetches it for search mode', () => {
    const selects = recipientSelects('dashboard/index.js');

    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(selects.filter((s) => !s.includes('preferred_language'))).toEqual([]);
  });

  it('getPendingBroadcastMessages carries the user language for the resume path', () => {
    const code = sourceWithoutLineComments('dashboard/database/queries.js');
    const fn = code.slice(code.indexOf('async function getPendingBroadcastMessages'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    expect(body).toContain('preferred_language');
  });
});

describe('template creation and template sending share one language namespace', () => {
  it('creates the template in the same code the send asks for', async () => {
    axios.post.mockImplementation((url) => {
      if (/message_templates$/.test(url)) return Promise.resolve({ data: { id: 'tpl-1' } });
      return okSend();
    });

    await broadcastService.createBroadcastTemplate('abc-123', 'Hello teachers');
    const [, createBody] = axios.post.mock.calls.find(([url]) => /message_templates$/.test(url));

    await broadcastService.sendTemplateMessage('923001234567', 'broadcast_abc_123', {
      preferredLanguage: 'en',
      availableLanguages: ['en'],
    });

    // If one of these is ever changed to 'en_US' without the other, Meta rejects
    // every send with "template name does not exist in the language".
    expect(sentLanguageCode()).toBe(createBody.language);
  });
});
