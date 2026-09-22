/**
 * bd-7beiz — the same recording scores the same, every time.
 *
 * Ported from the upstream bot's audio-hash dedupe, live there since 2026-04-18.
 *
 * Measured on NIETE production, 17 Aug – 20 Sep 2026: 1,515 groups of
 * byte-identical DC audio covering 3,515 sessions were each re-transcribed and
 * re-scored from scratch. Mean overall spread within a group 5.9 points, 335
 * groups ≥10 points, Section B (Lesson Plan Fidelity) spread averaging 6.9 of
 * 40 marks. One teacher (DC feedback rows 124-126) sent the same 2309-second
 * recording twice on 15 Sep with the same lesson plan attached and was told
 * 57.4% and then 63.5%.
 *
 * The rubric pass runs gpt-5-mini at temperature 1 with no seed, so every
 * submission is an independent sample. The fix does not make the scorer
 * deterministic — it stops the same bytes being sampled twice.
 *
 * Scope: the DC (teacher self-recorded) path only, `observation_type IS NULL`.
 * A leader observation is left alone; its debrief is a separate state machine.
 */

const crypto = require('crypto');

describe('computeAudioHash', () => {
  const { computeAudioHash } = require('../../bot/shared/services/coaching/audio-hash-cache');

  test('is the sha256 of the bytes', () => {
    const buf = Buffer.from('some classroom audio');
    expect(computeAudioHash(buf))
      .toBe(crypto.createHash('sha256').update(buf).digest('hex'));
  });

  test('two buffers with the same bytes hash the same', () => {
    expect(computeAudioHash(Buffer.from('abc'))).toBe(computeAudioHash(Buffer.from('abc')));
  });

  test('one different byte is a different hash', () => {
    expect(computeAudioHash(Buffer.from('abc'))).not.toBe(computeAudioHash(Buffer.from('abd')));
  });
});

describe('findRecentDuplicateSession', () => {
  const { findRecentDuplicateSession } = require('../../bot/shared/services/coaching/audio-hash-cache');
  const HASH = 'a'.repeat(64);

  /** Chainable PostgREST double that records every filter it was given. */
  function supabaseDouble(result) {
    const calls = { eq: [], gte: [], neq: [], is: [], select: [], from: [] };
    const q = {
      from: (t) => { calls.from.push(t); return q; },
      select: (c) => { calls.select.push(c); return q; },
      eq: (c, v) => { calls.eq.push([c, v]); return q; },
      is: (c, v) => { calls.is.push([c, v]); return q; },
      gte: (c, v) => { calls.gte.push([c, v]); return q; },
      neq: (c, v) => { calls.neq.push([c, v]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => result,
    };
    q.calls = calls;
    return q;
  }

  test('matches on the same user, the same hash and a completed session only', async () => {
    const sb = supabaseDouble({ data: { id: 'prior' }, error: null });
    await findRecentDuplicateSession(sb, {
      userId: 'u1', audioHash: HASH, windowDays: 7, excludeSessionId: 'current',
    });
    expect(sb.calls.eq).toEqual(expect.arrayContaining([
      ['user_id', 'u1'],
      ['audio_hash', HASH],
      ['status', 'completed'],
    ]));
    expect(sb.calls.neq).toEqual([['id', 'current']]);
    expect(sb.calls.gte[0][0]).toBe('created_at');
  });

  test('never dedupes against a leader observation', async () => {
    const sb = supabaseDouble({ data: null, error: null });
    await findRecentDuplicateSession(sb, {
      userId: 'u1', audioHash: HASH, windowDays: 7, excludeSessionId: 'current',
    });
    expect(sb.calls.is).toEqual(expect.arrayContaining([['observation_type', null]]));
  });

  test('a query error is not a duplicate', async () => {
    const sb = supabaseDouble({ data: null, error: { message: 'boom' } });
    expect(await findRecentDuplicateSession(sb, {
      userId: 'u1', audioHash: HASH, windowDays: 7,
    })).toBeNull();
  });

  test('no prior session is not a duplicate', async () => {
    const sb = supabaseDouble({ data: null, error: null });
    expect(await findRecentDuplicateSession(sb, {
      userId: 'u1', audioHash: HASH, windowDays: 7,
    })).toBeNull();
  });

  test('missing userId or hash short-circuits without querying', async () => {
    const sb = supabaseDouble({ data: { id: 'prior' }, error: null });
    expect(await findRecentDuplicateSession(sb, { userId: null, audioHash: HASH })).toBeNull();
    expect(await findRecentDuplicateSession(sb, { userId: 'u1', audioHash: null })).toBeNull();
    expect(sb.calls.from).toEqual([]);
  });

  test('it will not return the in-flight session as its own duplicate', async () => {
    // A double that ignores .neq (an older PostgREST stub, or a filter that
    // silently did nothing) must still not produce a self-match.
    const sb = supabaseDouble({ data: { id: 'current' }, error: null });
    expect(await findRecentDuplicateSession(sb, {
      userId: 'u1', audioHash: HASH, windowDays: 7, excludeSessionId: 'current',
    })).toBeNull();
  });
});

describe('a duplicate submission reuses the prior score instead of re-scoring', () => {
  const {
    resolveDuplicateSubmission,
  } = require('../../bot/shared/services/coaching/audio-hash-cache');

  const PRIOR = {
    id: 'prior-session',
    created_at: '2026-09-15T05:59:46.391Z',
    analysis_data: { framework: 'fico', scores: { overall_marks: 85, overall_max_marks: 148 } },
    report_pdf_url: 'https://r2.example/prior-report.pdf',
  };

  function deps(overrides = {}) {
    const sent = { messages: [], documents: [] };
    const written = [];
    return {
      sent,
      written,
      opts: {
        updateIfNotTerminal: async (id, patch) => { written.push([id, patch]); return { applied: true }; },
        sendMessage: async (to, body) => { sent.messages.push([to, body]); },
        sendDocumentFromUrl: async (to, url) => { sent.documents.push([to, url]); },
        getMessage: (key, lang) => `catalog:${key}:${lang}`,
        getLanguage: async () => 'ur',
        log: () => {},
        ...overrides,
      },
    };
  }

  test('copies the prior analysis and records what it was a duplicate of', async () => {
    const d = deps();
    const handled = await resolveDuplicateSubmission({
      coachingSessionId: 'current-session',
      from: '923497552393',
      userId: 'u1',
      audioHash: 'b'.repeat(64),
      duplicate: PRIOR,
    }, d.opts);

    expect(handled).toBe(true);
    const [id, patch] = d.written[0];
    expect(id).toBe('current-session');
    expect(patch.analysis_data).toEqual(PRIOR.analysis_data);
    expect(patch.duplicate_of_session_id).toBe('prior-session');
    expect(patch.audio_hash).toBe('b'.repeat(64));
    expect(patch.status).toBe('completed');
  });

  test('tells the teacher in HER language, from the catalog — never an English literal', async () => {
    const d = deps();
    await resolveDuplicateSubmission({
      coachingSessionId: 'current-session',
      from: '923497552393',
      userId: 'u1',
      audioHash: 'b'.repeat(64),
      duplicate: PRIOR,
    }, d.opts);

    expect(d.sent.messages).toHaveLength(1);
    const [to, body] = d.sent.messages[0];
    expect(to).toBe('923497552393');
    expect(body).toBe('catalog:duplicateRecording:ur');
  });

  test('resends the prior report when there is one', async () => {
    const d = deps();
    await resolveDuplicateSubmission({
      coachingSessionId: 'current-session', from: '92349', userId: 'u1',
      audioHash: 'b'.repeat(64), duplicate: PRIOR,
    }, d.opts);
    expect(d.sent.documents[0][1]).toBe('https://r2.example/prior-report.pdf');
  });

  test('a failed resend does not fail the dedupe — the score is already reused', async () => {
    const d = deps({ sendDocumentFromUrl: async () => { throw new Error('media gone'); } });
    await expect(resolveDuplicateSubmission({
      coachingSessionId: 'current-session', from: '92349', userId: 'u1',
      audioHash: 'b'.repeat(64), duplicate: PRIOR,
    }, d.opts)).resolves.toBe(true);
    expect(d.written).toHaveLength(1);
  });

  test('a cancelled session is not reopened by a duplicate hit (bd-n9832)', async () => {
    const d = deps({
      updateIfNotTerminal: async () => ({ applied: false }),
    });
    const handled = await resolveDuplicateSubmission({
      coachingSessionId: 'current-session', from: '92349', userId: 'u1',
      audioHash: 'b'.repeat(64), duplicate: PRIOR,
    }, d.opts);

    expect(handled).toBe(true);        // still short-circuits — we do not transcribe
    expect(d.sent.messages).toEqual([]); // but the teacher is not messaged
    expect(d.sent.documents).toEqual([]);
  });
});

describe('the catalog carries the duplicate-recording message in every offered language', () => {
  test('en and ur are both real strings, not the TODO sentinel', () => {
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    for (const lang of ['en', 'ur']) {
      const msg = getCoachingMessage('duplicateRecording', lang);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain('__TODO_TRANSLATE__');
    }
    expect(getCoachingMessage('duplicateRecording', 'ur'))
      .not.toBe(getCoachingMessage('duplicateRecording', 'en'));
  });
});
