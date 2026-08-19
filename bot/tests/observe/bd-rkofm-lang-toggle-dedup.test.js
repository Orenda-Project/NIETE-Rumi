/**
 * bd-rkofm / bd-sf6m7 / bd-fwqvm — three faults from 19 Aug field reports.
 *
 * bd-rkofm (Rifat, #region-islamabad 13:33): "you have added an option in the
 * feedback report to select the language ... when we select a language and send
 * the report, it takes a very long time, and even after waiting, the report is
 * still not delivered to the teacher."
 *
 *   handleSendLangToggle re-queues observe_teacher_report with phase 'preview'
 *   — the SAME phase the first preview used. The SQS dedup id is
 *   `${sessionId}-${jobType}-${phase}`, the FIFO dedup window is 5 MINUTES, and
 *   a coach taps the language button seconds after seeing the preview. So the
 *   re-preview carried an identical dedup id, SQS discarded it, and SendMessage
 *   still returned a MessageId — the log reads "queued to SQS" and nothing ever
 *   runs. Same failure shape as bd-2652, one layer along.
 *
 *   Evidence from her actual session (3cb9095b): lang_override 'ur' recorded,
 *   yet the delivered caption and companion text are the ENGLISH ones written
 *   at the first preview — the Urdu re-render never happened.
 *
 * bd-sf6m7. Worse: queueObserveDebrief has set payload.dedupNonce since bd-56,
 * but the dedup id never included it, so that whole mechanism was inert. This
 * is also Nouman's point 3 — a second debrief recording for the same session
 * inside 5 minutes was silently dropped.
 *
 * bd-fwqvm. The "Remove a school from my list" link sat BETWEEN the screen's
 * description and the search box, so it read as the search box's label. A coach
 * typed the EMIS of the school she wanted to REMOVE, hit Search, and was offered
 * it to ADD.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// The rule is exported as a pure function. It used to be a three-deep nested
// template literal that could only be checked by parsing the source — which is
// exactly how a broken key survived twice, and how this test file's own first
// attempt fooled itself (the regex stopped at a nested backtick).
const { buildDedupId: dedupIdFor } = require('../../shared/services/queue/sqs-queue.service');

describe('bd-rkofm · a re-queued preview must not collide with the first one', () => {
  it('two previews for the same session get DIFFERENT dedup ids when a nonce distinguishes them', () => {
    const first = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview' });
    const retry = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview', dedupNonce: 'lang-ur' });
    expect(first).not.toBe(retry);
  });

  // REMOVED 2026-08-19 (bd-dy7hs): "the language toggle attaches a nonce, so the
  // re-render actually runs". The toggle itself is gone — the report is rendered
  // in the teacher's own language the first time, so there is no second render
  // to dedup. The dedup-id rule it exercised is still pinned by the tests either
  // side of this note, which is the part that generalises.

  it('tapping the same toggle twice still dedups — one re-render, not two', () => {
    const a = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview', dedupNonce: 'lang-ur' });
    const b = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview', dedupNonce: 'lang-ur' });
    expect(a).toBe(b);
  });

  it('switching to a different language is a different job', () => {
    const ur = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview', dedupNonce: 'lang-ur' });
    const en = dedupIdFor('s1', 'observe_teacher_report', { phase: 'preview', dedupNonce: 'lang-en' });
    expect(ur).not.toBe(en);
  });
});

describe('bd-sf6m7 · the nonce mechanism must not be inert', () => {
  it('dedupNonce reaches the dedup id — bd-56 set it and nothing read it', () => {
    const withN = dedupIdFor('s1', 'observe_debrief', { dedupNonce: 'abc123' });
    const without = dedupIdFor('s1', 'observe_debrief', {});
    expect(withN).toContain('abc123');
    expect(withN).not.toBe(without);
  });

  it('a job with neither phase nor nonce keeps its historical id exactly', () => {
    expect(dedupIdFor('s1', 'coaching_analysis', {})).toBe('s1-coaching_analysis');
  });

  it('stays inside the 128-char SQS ceiling', () => {
    const id = dedupIdFor('a'.repeat(40), 'observe_teacher_report', { phase: 'preview', dedupNonce: 'b'.repeat(40) });
    expect(id.length).toBeLessThanOrEqual(128);
  });
});

describe('bd-fwqvm · the remove link must not read as the search box label', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const screen = flow.screens.find((s) => s.id === 'ADD_SEARCH');
  const kinds = screen.layout.children.map((c) => c.type);

  it('the link comes AFTER the form, not between the description and the search box', () => {
    expect(kinds.indexOf('EmbeddedLink')).toBeGreaterThan(kinds.indexOf('Form'));
  });

  it('the body says what the search box is for, so an EMIS typed there is unambiguous', () => {
    const body = screen.layout.children.find((c) => c.type === 'TextBody').text.toLowerCase();
    expect(body).toMatch(/add/);
  });

  it('the link still opens the remove path', () => {
    // bd-gndeg moved this one hop: the link now opens the SEARCH screen, which
    // then lists the matching schools. The destination is the same, the route
    // gained a filter in front of it.
    const link = screen.layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(link['on-click-action'].payload.step).toBe('manage_search');
  });
});
