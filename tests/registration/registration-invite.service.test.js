/**
 * The ONE way any door sends the registration Flow (registration-invite.service.js).
 *
 * Before this there were four senders with four behaviours: /register sent the Flow with a
 * bare user id as its token and English-only copy, the keyword branch sent no Flow at all,
 * sendNameQuestion sent a third copy, and nothing ever offered the form to a new person.
 * This pins the one sender:
 *   - the token is "<userId>:registration:<ts>" — the endpoint reads the user id before the
 *     first colon, and the completion is recognised by ":registration:";
 *   - the copy is the teacher's language (en/ur, English floor) and fits WhatsApp's caps,
 *     measured in code points;
 *   - "offered once" is users.registration_started_at, claimed with a conditional update so
 *     two doors racing cannot both send it;
 *   - a refused send is never silent: she gets a line to retry, and it logs at error.
 */

const FLOW_ID = 'flow_reg_test';

function makeDb({ row = null, claimRows = [{ id: 'u1' }] } = {}) {
  const calls = { selects: [], updates: [] };
  const db = {
    calls,
    from(table) {
      const q = { table, filters: [] };
      const builder = {
        select(cols) {
          if (q.op === 'update') { q.returning = cols; return builder; }
          q.op = 'select'; q.cols = cols; return builder;
        },
        update(patch) { q.op = 'update'; q.patch = patch; return builder; },
        eq(col, val) { q.filters.push(['eq', col, val]); return builder; },
        is(col, val) { q.filters.push(['is', col, val]); return builder; },
        maybeSingle() {
          calls.selects.push(q);
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve, reject) {
          calls.updates.push(q);
          const data = q.returning ? claimRows : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return db;
}

function load({ flowId = FLOW_ID, db = makeDb(), sendFlowResult = true } = {}) {
  jest.resetModules();
  if (flowId) process.env.REGISTRATION_FLOW_ID = flowId; else delete process.env.REGISTRATION_FLOW_ID;
  const logger = { logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() };
  jest.doMock('../../bot/shared/utils/logger', () => logger);
  const wa = {
    sendFlow: jest.fn().mockResolvedValue(sendFlowResult),
    sendMessage: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => wa);
  jest.doMock('../../bot/shared/config/supabase', () => db);
  const svc = require('../../bot/shared/services/registration-invite.service');
  return { svc, wa, db, logger };
}

const NEW_USER = { id: 'u1', name: null, registration_completed: false, registration_state: 'unregistered', registration_started_at: null };
const NAMED_USER = { ...NEW_USER, name: 'Ayesha Bano' };
// A roster row the form has nothing to add to: name, school and a form role (flag still false).
const COMPLETE_USER = { ...NAMED_USER, school_id: 'school-1', role: 'teacher' };
const cp = (s) => [...String(s)].length;

const ORIG = process.env.REGISTRATION_FLOW_ID;
afterAll(() => {
  if (ORIG === undefined) delete process.env.REGISTRATION_FLOW_ID; else process.env.REGISTRATION_FLOW_ID = ORIG;
});

describe('sendRegistrationInvite', () => {
  test('sends the Flow with a "<userId>:registration:<ts>" token, first-time copy, and stamps the first offer', async () => {
    const { svc, wa, db } = load();
    const ok = await svc.sendRegistrationInvite({ user: NEW_USER, phone: '923001234567', language: 'en', reason: 'register_command' });

    expect(ok).toBe(true);
    expect(wa.sendFlow).toHaveBeenCalledTimes(1);
    const [to, args] = wa.sendFlow.mock.calls[0];
    expect(to).toBe('923001234567');
    expect(args.flowId).toBe(FLOW_ID);
    expect(args.flowToken).toMatch(/^u1:registration:\d{10,}$/);
    expect(args.screen).toBeUndefined(); // endpoint Flow: opens with data_exchange
    expect(args.header).toBe(svc.inviteCopy({ variant: 'new', language: 'en' }).header);
    expect(wa.sendMessage).not.toHaveBeenCalled();

    const stamp = db.calls.updates.find((u) => u.patch && 'registration_started_at' in u.patch);
    expect(stamp).toBeTruthy();
    expect(stamp.filters).toEqual(expect.arrayContaining([['eq', 'id', 'u1'], ['is', 'registration_started_at', null]]));
  });

  test('a registered teacher gets the "update your details" copy', async () => {
    const { svc, wa } = load();
    await svc.sendRegistrationInvite({ user: NAMED_USER, phone: '923001234567', language: 'en', reason: 'register_intent' });
    expect(wa.sendFlow.mock.calls[0][1].header).toBe('Update your details');
  });

  test('an unregistered adult reaching a school feature gets the school copy', async () => {
    const { svc, wa } = load();
    await svc.sendRegistrationInvite({ user: NEW_USER, phone: '923001234567', language: 'en', reason: 'school_feature' });
    expect(wa.sendFlow.mock.calls[0][1].body).toBe(svc.inviteCopy({ variant: 'school', language: 'en' }).body);
  });

  test('a REGISTERED teacher with no school reaching a school feature also gets the school copy, not "update"', async () => {
    const { svc, wa } = load();
    await svc.sendRegistrationInvite({ user: { ...NAMED_USER, role: 'teacher' }, phone: 'p', language: 'en', reason: 'school_feature' });
    expect(wa.sendFlow.mock.calls[0][1].header).toBe(svc.inviteCopy({ variant: 'school', language: 'en' }).header);
  });

  test('Urdu copy for an Urdu teacher; anything off-offer falls to English', async () => {
    const { svc, wa } = load();
    await svc.sendRegistrationInvite({ user: NEW_USER, phone: 'p', language: 'ur', reason: 'first_reply' });
    await svc.sendRegistrationInvite({ user: NEW_USER, phone: 'p', language: 'sw', reason: 'first_reply' });
    expect(wa.sendFlow.mock.calls[0][1].header).toBe(svc.inviteCopy({ variant: 'new', language: 'ur' }).header);
    expect(wa.sendFlow.mock.calls[0][1].header).not.toBe(svc.inviteCopy({ variant: 'new', language: 'en' }).header);
    expect(wa.sendFlow.mock.calls[1][1].header).toBe(svc.inviteCopy({ variant: 'new', language: 'en' }).header);
  });

  test('reads the account when the caller only has an id (the workers)', async () => {
    const db = makeDb({ row: NAMED_USER });
    const { svc, wa } = load({ db });
    await svc.sendRegistrationInvite({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'after_first_feature' });
    expect(db.calls.selects.length).toBeGreaterThan(0);
    expect(wa.sendFlow.mock.calls[0][1].header).toBe('Update your details');
  });

  test('a refused send is not silent: she gets a line to retry with /register, and it logs at error', async () => {
    const { svc, wa, logger } = load({ sendFlowResult: false });
    const ok = await svc.sendRegistrationInvite({ user: NEW_USER, phone: 'p', language: 'en', reason: 'register_command' });
    expect(ok).toBe(false);
    expect(wa.sendMessage).toHaveBeenCalledTimes(1);
    expect(wa.sendMessage.mock.calls[0][1]).toMatch(/\/register/);
    expect(logger.logError).toHaveBeenCalled();
  });

  test('no Flow configured: no Flow, a plain "not available" line, false', async () => {
    const { svc, wa } = load({ flowId: null });
    const ok = await svc.sendRegistrationInvite({ user: NEW_USER, phone: 'p', language: 'en', reason: 'register_command' });
    expect(ok).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
    expect(wa.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('no account id (lookup failed): no Flow is sent with a phone number for a token', async () => {
    const { svc, wa } = load();
    const ok = await svc.sendRegistrationInvite({ user: null, phone: 'p', language: 'en', reason: 'register_command' });
    expect(ok).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });
});

describe('offerRegistrationOnce', () => {
  test('a complete account (name + school + teacher) is never offered', async () => {
    const db = makeDb({ row: COMPLETE_USER });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });

  test('a roster row with a name but no school IS offered — once', async () => {
    const db = makeDb({ row: { ...NAMED_USER, role: 'teacher' }, claimRows: [{ id: 'u1' }] });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(true);
    expect(wa.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('completed the form but no school: not offered unprompted (the school doors ask instead)', async () => {
    const db = makeDb({ row: { ...NAMED_USER, role: 'teacher', registration_completed: true } });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });

  test('an admin-set coach is never offered, school or not', async () => {
    const db = makeDb({ row: { ...NAMED_USER, role: 'coach' } });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });

  test('already offered once: not again', async () => {
    const db = makeDb({ row: { ...NEW_USER, registration_started_at: '2026-10-16T08:00:00Z' } });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });

  test('never offered: claims the offer first, then sends', async () => {
    const db = makeDb({ row: NEW_USER, claimRows: [{ id: 'u1' }] });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' })).toBe(true);
    const claim = db.calls.updates.find((u) => u.patch && u.patch.registration_started_at);
    expect(claim.filters).toEqual(expect.arrayContaining([['is', 'registration_started_at', null]]));
    expect(wa.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('another door claimed it a moment earlier: not sent twice', async () => {
    const db = makeDb({ row: NEW_USER, claimRows: [] });
    const { svc, wa } = load({ db });
    expect(await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'after_first_feature' })).toBe(false);
    expect(wa.sendFlow).not.toHaveBeenCalled();
  });

  test('the send failed: the claim is released so a later message can offer it', async () => {
    const db = makeDb({ row: NEW_USER, claimRows: [{ id: 'u1' }] });
    const { svc } = load({ db, sendFlowResult: false });
    await svc.offerRegistrationOnce({ user: { id: 'u1' }, phone: 'p', language: 'en', reason: 'first_reply' });
    const release = db.calls.updates.find((u) => u.patch && u.patch.registration_started_at === null);
    expect(release).toBeTruthy();
  });
});

describe('invite copy fits WhatsApp, in both languages', () => {
  const { svc } = load();
  test.each(svc.VARIANTS.flatMap((v) => ['en', 'ur'].map((l) => [v, l])))('%s / %s', (variant, language) => {
    const c = svc.inviteCopy({ variant, language });
    expect(cp(c.header)).toBeGreaterThan(0);
    expect(cp(c.header)).toBeLessThanOrEqual(60);
    expect(cp(c.body)).toBeLessThanOrEqual(1024);
    expect(cp(c.buttonText)).toBeLessThanOrEqual(20);
    if (c.footer) expect(cp(c.footer)).toBeLessThanOrEqual(60);
  });

  test('the Urdu retry line isolates /register so it is not painted "register/"', () => {
    const line = svc.fallbackText({ kind: 'retry', language: 'ur' });
    expect(line).toContain('⁦/register⁩');
  });
});
