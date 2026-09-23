/**
 * A telemetry label must not change which cassette a request replays. bd-t3u9t.
 *
 * `job` and `fallbackModel` ride in a create() call's params so llm-client can attribute spend and
 * arm a fallback, and llm-client strips both before the request reaches a vendor. They are not part
 * of what was asked. But the cassette wraps OUTSIDE llm-client (getClient() applies it last), so it
 * saw them, and `normaliseForKey` keeps every key -- so the label went into the sha256.
 *
 * bd-jntcx and bd-8xmp9 then labelled 57 call sites. Every sealed LLM cassette in
 * .claude/qa/fixtures/cassettes was recorded before that (61 of 63) with no label in its request, so
 * on replay the same request plus a label hashed to a key nothing was stored under. In the mock lane
 * that is `replay-strict`, where a miss throws E2E_CASSETTE_MISS. It went unnoticed because the lane
 * could not run on the machine that shipped the labels, and CI reports its proof as a warning.
 *
 * These drive the REAL wrapChatCompletions against the REAL committed cassettes. The only thing
 * faked is the vendor -- the network boundary -- and a hit must never reach it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = 'https://olvritwoqujtjvwfulbh.supabase.co';
const SEALED = path.join(__dirname, '..', '..', '.claude', 'qa', 'fixtures', 'cassettes');

const fresh = (env) => {
  jest.resetModules();
  for (const k of [
    'E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'E2E_CASSETTE_MISS_LOG', 'SUPABASE_URL',
    // Hermetic: a local miss falls through to R2 when these are set. A test must never read R2.
    'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  ]) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../bot/shared/services/e2e-cassette');
};

/** A vendor that must not be reached on a hit. */
const vendor = () => {
  const calls = [];
  const client = { chat: { completions: { create: async (params) => {
    calls.push(params);
    return { id: 'live', choices: [{ message: { role: 'assistant', content: 'LIVE' } }] };
  } } } };
  return { client, calls };
};

/**
 * The sealed cassettes whose stored request reproduces their stored key. The stored request is the
 * key input with long strings cut at 4000 characters, so a cassette with a longer prompt cannot be
 * replayed from its own record; those are left out rather than counted as misses.
 */
function reproducible(c) {
  return fs.readdirSync(SEALED)
    .filter((f) => f.startsWith('llm-') && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SEALED, f), 'utf8')))
    .filter((rec) => rec.request && c.keyFor('llm', c.normaliseForKey(rec.request)) === rec.key);
}

describe('the cassette key ignores telemetry labels (bd-t3u9t)', () => {
  test('there are real sealed cassettes to test against', () => {
    // Guard the guard: with none found, every assertion below would pass vacuously.
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: SEALED, SUPABASE_URL: SANDBOX });
    expect(reproducible(c).length).toBeGreaterThanOrEqual(15);
  });

  test('every reproducible sealed cassette still HITS once the request carries a label', async () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: SEALED, SUPABASE_URL: SANDBOX });
    const recs = reproducible(c);
    const { client, calls } = vendor();
    c.wrapChatCompletions(client);

    const missed = [];
    for (const rec of recs) {
      try {
        const got = await client.chat.completions.create({
          ...rec.request, job: 'coaching.pedagogy', fallbackModel: null,
        });
        expect(got).toEqual(rec.value);
      } catch (e) {
        missed.push(`${rec.key.slice(0, 20)} ${String(e.message).slice(0, 40)}`);
      }
    }
    expect(missed).toEqual([]);
    expect(calls).toHaveLength(0); // a hit never reaches the vendor
  });
});

describe('only the KEY ignores them (bd-t3u9t)', () => {
  test('recording still hands the vendor the full request, label included', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-telemetry-'));
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    const { client, calls } = vendor();
    c.wrapChatCompletions(client);

    const request = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0 };
    await client.chat.completions.create({ ...request, job: 'quiz.insight', fallbackModel: null });

    // The inner wrapper (llm-client) needs the job to attribute spend; the cassette must not eat it.
    expect(calls).toHaveLength(1);
    expect(calls[0].job).toBe('quiz.insight');

    // ...and what got stored is keyed as the request without its labels.
    const [file] = fs.readdirSync(dir);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(stored.key).toBe(c.keyFor('llm', c.normaliseForKey(request)));
    expect('job' in stored.request).toBe(false);
  });

  test('a real change to the request still changes the key -- nothing else is stripped', async () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: SEALED, SUPABASE_URL: SANDBOX });
    const [rec] = reproducible(c);
    const { client, calls } = vendor();
    c.wrapChatCompletions(client);

    const changed = [
      { ...rec.request, model: `${rec.request.model}-other` },
      { ...rec.request, messages: [...rec.request.messages, { role: 'user', content: 'and one more' }] },
      { ...rec.request, temperature: (rec.request.temperature ?? 0) + 0.3 },
      { ...rec.request, max_tokens: (rec.request.max_tokens ?? 100) + 1 },
    ];
    for (const req of changed) {
      await expect(client.chat.completions.create({ ...req, job: 'coaching.pedagogy' }))
        .rejects.toThrow(/E2E_CASSETTE_MISS/);
    }
    expect(calls).toHaveLength(0); // strict: a miss never goes live either
  });
});
