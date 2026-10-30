/**
 * A coach's "Send feedback" from the app's More page: what she sends (a topic, her words and/or a voice
 * message, up to three screenshots) is checked against her own uploads, kept in coach_feedback (the table
 * "Report an issue" started, bd-whlsm0: one table for one form), and only then transcribed and posted to
 * the team's Slack channel — after the app has its answer.
 */

const SERVICE = '../../bot/shared/services/feedback/app-feedback.service';
const COACHING = '../../bot/shared/services/coaching/portal-coaching.service';

const UID = '11111111-2222-4333-8444-555555555555';
const AUDIO = `feedback_audio/${UID}/2026-10/portal_a1.webm`;
const SHOT = (n) => `feedback_images/${UID}/portal_s${n}.png`;

function fakeDb({ recent = 0, user = { name: 'Ayesha Khan' } } = {}) {
  const calls = { inserts: [], updates: [] };
  const supabase = {
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select(cols, opts) { q.select = cols; q.opts = opts; return chain; },
        insert(row) { calls.inserts.push({ table, row }); q.insert = row; return chain; },
        update(row) { q.update = row; return chain; },
        eq(c, v) {
          q.filters.push([c, v]);
          if (q.update) { calls.updates.push({ table, row: q.update, where: [c, v] }); return Promise.resolve({ error: null }); }
          return chain;
        },
        gte(c, v) {
          q.filters.push([c, v]);
          return Promise.resolve({ count: recent, error: null });
        },
        single() {
          if (q.insert) return Promise.resolve({ data: { id: 'fb-1' }, error: null });
          return Promise.resolve({ data: user, error: null });
        },
        maybeSingle() { return Promise.resolve({ data: user, error: null }); },
      };
      return chain;
    },
  };
  return { supabase, calls };
}

function deps(over = {}) {
  const db = fakeDb(over.db);
  const later = [];
  const d = {
    supabase: db.supabase,
    r2: {
      headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1000 }),
      getPresignedGetUrl: jest.fn(async (key, ttl) => `https://r2.example/${key}?ttl=${ttl}`),
    },
    getUserLanguage: jest.fn().mockResolvedValue('ur'),
    transcribe: jest.fn().mockResolvedValue({ text: 'The Schools page does not open', language: 'en' }),
    postToSlack: jest.fn().mockResolvedValue('171.1'),
    env: { APP_FEEDBACK_SLACK_CHANNEL: 'C123', PROD_DIGEST_SLACK_TOKEN: 'xoxb-test' },
    later: (fn) => later.push(fn),
    logError: jest.fn(),
    logWarn: jest.fn(),
    now: () => new Date('2026-10-30T10:00:00Z'),
    ...over.deps,
  };
  return { d, db, later };
}

describe('app feedback — submitFeedback', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('a typed message is saved for her and answered before anything else happens', async () => {
    const { d, db, later } = deps();
    const out = await Svc.submitFeedback({ userId: UID, topic: 'broken', text: '  Schools will not open  ' }, d);
    expect(out).toEqual({ status: 'ok', feedbackId: 'fb-1' });
    expect(db.calls.inserts).toEqual([{
      table: 'coach_feedback',
      row: {
        user_id: UID, kind: 'broken', message: 'Schools will not open', page: null, audio_key: null, photo_keys: [], context: {},
      },
    }]);
    // Transcription and Slack wait until she has her answer.
    expect(later).toHaveLength(1);
    expect(d.postToSlack).not.toHaveBeenCalled();
  });

  test('a voice message alone is enough, and screenshots ride along', async () => {
    const { d, db } = deps();
    const out = await Svc.submitFeedback({ userId: UID, topic: 'idea', audioKey: AUDIO, photoKeys: [SHOT(1), SHOT(2)] }, d);
    expect(out.status).toBe('ok');
    expect(db.calls.inserts[0].row).toMatchObject({ message: null, audio_key: AUDIO, photo_keys: [SHOT(1), SHOT(2)] });
    expect(d.r2.headObject).toHaveBeenCalledTimes(3);
  });

  test.each([
    ['nothing said', { topic: 'broken' }, 'empty'],
    ['only spaces', { topic: 'broken', text: '   ' }, 'empty'],
    ['an unknown topic', { topic: 'complaint', text: 'x' }, 'bad_topic'],
    ['the old "problem" topic', { topic: 'problem', text: 'x' }, 'bad_topic'],
    ['2001 characters', { topic: 'broken', text: 'x'.repeat(2001) }, 'too_long'],
    ['four screenshots', { topic: 'broken', text: 'x', photoKeys: [SHOT(1), SHOT(2), SHOT(3), SHOT(4)] }, 'too_many_photos'],
    ['screenshots that are not a list', { topic: 'broken', text: 'x', photoKeys: 'not-a-list' }, 'bad_photos'],
  ])('refuses %s as %s, and writes nothing', async (_label, args, reason) => {
    const { d, db } = deps();
    const out = await Svc.submitFeedback({ userId: UID, ...args }, d);
    expect(out).toEqual({ status: 'invalid', reason });
    expect(db.calls.inserts).toEqual([]);
  });

  test('an upload she did not make, or of the wrong kind, is refused', async () => {
    const { d } = deps();
    const other = 'feedback_audio/99999999-2222-4333-8444-555555555555/2026-10/portal_a1.webm';
    expect(await Svc.submitFeedback({ userId: UID, topic: 'other', audioKey: other }, d))
      .toEqual({ status: 'invalid', reason: 'not_own_upload' });
    // a reflection recording is hers, but it is not a feedback message
    expect(await Svc.submitFeedback({ userId: UID, topic: 'other', audioKey: `reflection_audio/${UID}/2026-10/portal_a1.webm` }, d))
      .toEqual({ status: 'invalid', reason: 'not_own_upload' });
    expect(await Svc.submitFeedback({ userId: UID, topic: 'other', text: 'x', photoKeys: [`images/${UID}/portal_s1.png`] }, d))
      .toEqual({ status: 'invalid', reason: 'not_own_upload' });
  });

  test('a signed upload that never arrived is refused', async () => {
    const { d, db } = deps();
    d.r2.headObject.mockResolvedValue({ exists: false });
    const out = await Svc.submitFeedback({ userId: UID, topic: 'broken', audioKey: AUDIO }, d);
    expect(out).toMatchObject({ status: 'invalid', reason: 'upload_missing' });
    expect(db.calls.inserts).toEqual([]);
  });

  test('more than twenty in a day is refused, so a stuck tap cannot flood the channel', async () => {
    const { d, db } = deps({ db: { recent: 20 } });
    const out = await Svc.submitFeedback({ userId: UID, topic: 'broken', text: 'again' }, d);
    expect(out).toEqual({ status: 'invalid', reason: 'too_many' });
    expect(db.calls.inserts).toEqual([]);
  });

  test('the four kinds of Report an issue are the topics, numbers among them', async () => {
    expect(Svc.TOPICS).toEqual(['broken', 'numbers', 'idea', 'other']);
    const { d, db } = deps();
    expect((await Svc.submitFeedback({ userId: UID, topic: 'numbers', text: 'Visits show 0' }, d)).status).toBe('ok');
    expect(db.calls.inserts[0].row.kind).toBe('numbers');
  });

  test('the page she sent it from is kept only as a portal address', async () => {
    const { d, db } = deps();
    await Svc.submitFeedback({ userId: UID, topic: 'idea', text: 'x', page: '/portal/coach/more' }, d);
    expect(db.calls.inserts[0].row.page).toBe('/portal/coach/more');
    const again = deps();
    await Svc.submitFeedback({ userId: UID, topic: 'idea', text: 'x', page: 'https://evil.example/' }, again.d);
    expect(again.db.calls.inserts[0].row.page).toBeNull();
  });

  test('only the context fields we read are kept, each checked', async () => {
    const { d, db } = deps();
    await Svc.submitFeedback({
      userId: UID, topic: 'broken', text: 'x',
      context: { surface: 'coach_more', browser: 'whatsapp-iab', appBuild: 1216, phone: '0300' },
    }, d);
    expect(db.calls.inserts[0].row.context).toEqual({ browser: 'whatsapp-iab', appBuild: 1216 });

    const again = deps();
    await Svc.submitFeedback({
      userId: UID, topic: 'broken', text: 'x', context: { browser: 'netscape', appBuild: 'x' },
    }, again.d);
    expect(again.db.calls.inserts[0].row.context).toEqual({});
  });

  test('no user is refused before anything is read', async () => {
    const { d } = deps();
    expect(await Svc.submitFeedback({ topic: 'broken', text: 'x' }, d)).toEqual({ status: 'invalid', reason: 'no_user' });
  });
});

describe('app feedback — afterwards: transcript, then Slack', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('the voice message is transcribed onto the row, then one Slack post names her, the topic and the links', async () => {
    const { d, db, later } = deps();
    await Svc.submitFeedback({ userId: UID, topic: 'broken', text: 'see the picture', audioKey: AUDIO, photoKeys: [SHOT(1)] }, d);
    await later[0]();

    expect(d.transcribe).toHaveBeenCalledWith(AUDIO, 'ur');
    expect(db.calls.updates[0]).toEqual({
      table: 'coach_feedback', row: { audio_transcript: 'The Schools page does not open' }, where: ['id', 'fb-1'],
    });
    expect(d.postToSlack).toHaveBeenCalledTimes(1);
    const [text, target] = d.postToSlack.mock.calls[0];
    expect(target).toEqual({ token: 'xoxb-test', channel: 'C123' });
    expect(text).toContain('Ayesha Khan');
    expect(text).toContain('Something isn’t working');
    expect(text).toContain('see the picture');
    expect(text).toContain('The Schools page does not open');
    expect(text).toContain(`https://r2.example/${AUDIO}?ttl=604800`);
    expect(text).toContain(`https://r2.example/${SHOT(1)}?ttl=604800`);
    expect(text).not.toMatch(/03\d{2}|\+92/);
    expect(db.calls.updates[1]).toMatchObject({ table: 'coach_feedback', where: ['id', 'fb-1'] });
    expect(db.calls.updates[1].row.notified_at).toBe('2026-10-30T10:00:00.000Z');
  });

  test('with no channel set nothing is posted: the row is the record', async () => {
    const { d, db, later } = deps({ deps: { env: { PROD_DIGEST_SLACK_TOKEN: 'xoxb-test' } } });
    await Svc.submitFeedback({ userId: UID, topic: 'idea', text: 'more videos' }, d);
    const out = await later[0]();
    expect(out).toMatchObject({ notified: false, reason: 'no_channel' });
    expect(d.postToSlack).not.toHaveBeenCalled();
    expect(db.calls.updates).toEqual([]);
  });

  test('a failed transcription still posts, with the audio link', async () => {
    const { d, later } = deps();
    d.transcribe.mockRejectedValue(new Error('asr down'));
    await Svc.submitFeedback({ userId: UID, topic: 'broken', audioKey: AUDIO }, d);
    const out = await later[0]();
    expect(out).toMatchObject({ notified: true });
    expect(d.postToSlack.mock.calls[0][0]).toContain(AUDIO);
    expect(d.logWarn).toHaveBeenCalled();
    expect(d.logError).not.toHaveBeenCalled();
  });

  test('a failed Slack post never throws; it is logged and notified_at stays empty', async () => {
    const { d, db, later } = deps();
    d.postToSlack.mockRejectedValue(new Error('slack channel_not_found'));
    await Svc.submitFeedback({ userId: UID, topic: 'other', text: 'hello' }, d);
    const out = await later[0]();
    expect(out).toMatchObject({ notified: false, reason: 'post_failed' });
    expect(db.calls.updates).toEqual([]);
    expect(d.logError).toHaveBeenCalledWith('❌ App feedback Slack post failed', { feedbackId: 'fb-1', error: 'slack channel_not_found' });
  });
});

describe('app feedback — uploads', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('signs only the two feedback kinds, under her own id', async () => {
    const r2 = { getPresignedUploadUrl: jest.fn().mockResolvedValue('https://r2/put') };
    const d = { r2, now: () => new Date('2026-10-30T10:00:00Z'), newId: () => 'abc' };
    expect(await Svc.presignUpload({ userId: UID, filename: 'voice.webm', sizeBytes: 100, kind: 'feedback_audio' }, d))
      .toMatchObject({ status: 'ok', key: `feedback_audio/${UID}/2026-10/portal_abc.webm`, contentType: 'audio/webm' });
    expect(await Svc.presignUpload({ userId: UID, filename: 'Screenshot.PNG', sizeBytes: 100, kind: 'feedback_photo' }, d))
      .toMatchObject({ status: 'ok', key: `feedback_images/${UID}/portal_abc.png`, contentType: 'image/png' });
    expect(await Svc.presignUpload({ userId: UID, filename: 'a.webm', sizeBytes: 100, kind: 'audio' }, d))
      .toEqual({ status: 'invalid', reason: 'unknown_kind' });
    expect(await Svc.presignUpload({ userId: UID, filename: 'a.pdf', sizeBytes: 100, kind: 'feedback_photo' }, d))
      .toEqual({ status: 'invalid', reason: 'wrong_type' });
  });

  test('the two kinds live in the coaching upload table, so one signer and one ownership check serve both', () => {
    const { KINDS, isOwnPortalKey } = require(COACHING);
    expect(Object.keys(KINDS)).toEqual(expect.arrayContaining(['feedback_audio', 'feedback_photo']));
    expect(isOwnPortalKey(UID, AUDIO, 'feedback_audio')).toBe(true);
    expect(isOwnPortalKey(UID, SHOT(1), 'feedback_photo')).toBe(true);
    expect(isOwnPortalKey(UID, AUDIO, 'audio')).toBe(false);
  });
});
