'use strict';
/**
 * bd-4dkwaf — #niete-lp-quiz-alerts, 21–23 Nov 2026: "joined → 0 finished, 0 scorecards,
 * 0 class cards" and "class report owed" every 15–30 min, while production was fine:
 *   - 971 web finishes were logged (the finish had no stream; fixed in web-quiz-finish-event);
 *   - a web finisher's scorecard is the page itself: there is no WhatsApp scorecard to miss;
 *   - class cards were 0 sent / 141 skipped, all no_phone (web children have no number);
 *   - all 131 quizzes called "owed" had their class report sent BEFORE the 46 h look-back
 *     (earliest 27 Oct): a child re-opening an old class link owes the teacher nothing
 *     (scheduleForShareCode: one report per link). Owed is now judged per class link, with
 *     the link's whole recent history: first join 22–46 h ago and never reported.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const W = require('../../bot/shared/services/monitoring/quiz-funnel-watch.service');

const H = 60 * 60 * 1000;
const D = 24 * H;
const now = new Date(Date.UTC(2026, 10, 23, 10));
const t = now.getTime();
const iso = (ms) => new Date(ms).toISOString();
const CFG = W.config({});
const Q = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const C = (n) => `${String(n).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const kinds = (data) => W.findIncidents(data, now, CFG).map((i) => i.kind);
const joined = (q, sc, ago, source = 'lp_v8') => ({ q, sc, stage: 'child_joined', source, kind: '', t: iso(t - ago) });
const reported = (q, sc, ago, source = 'lp_v8') => ({ q, sc, stage: 'report_sent', source, kind: 'report', t: iso(t - ago) });

describe('a class report is owed per class link, against the link\'s history', () => {
  test('a link whose report went days ago owes nothing when a child re-opens it', () => {
    // As the alert saw it: the first join it could see was 23 h ago and no report in 46 h.
    expect(kinds({ reports: [joined(Q(1), C(1), 23 * H)] })).toEqual(['report_owed']);
    // With the link's history: first joined 6 days ago, reported 5 days ago.
    expect(kinds({ reports: [joined(Q(1), C(1), 6 * D), reported(Q(1), C(1), 5 * D)] })).toEqual([]);
  });

  test('a new class link on an old quiz still owes its own report', () => {
    const rows = [joined(Q(1), C(1), 6 * D), reported(Q(1), C(1), 5 * D), joined(Q(1), C(2), 23 * H)];
    const inc = W.findIncidents({ reports: rows }, now, CFG);
    expect(inc).toEqual([expect.objectContaining({ kind: 'report_owed', ids: [Q(1)] })]);
  });

  test('a link first joined 22–46 h ago and reported is fine; one first joined over 46 h ago is not re-raised', () => {
    expect(kinds({ reports: [joined(Q(1), C(1), 30 * H), reported(Q(1), C(1), 12 * H)] })).toEqual([]);
    expect(kinds({ reports: [joined(Q(1), C(1), 50 * H)] })).toEqual([]);
  });

  test('the reports query keeps the class link and reaches back reportHistoryD days', async () => {
    expect(CFG.reportHistoryD).toBeGreaterThanOrEqual(30);
    expect(W.aplFor({ env: 'production', dataset: 'niete-logs', now }).reports).toMatch(/sc = tostring\(d\.share_code_id\)/);
    const asked = {};
    await W.buildReport({
      now, env: 'production', dataset: 'niete-logs', cfg: CFG,
      query: async (name, apl, start) => { asked[name] = start; return []; },
    });
    expect(Date.parse(asked.reports)).toBe(t - CFG.reportHistoryD * D);
  });
});

describe('a web finisher\'s scorecard is the page', () => {
  test('a web finish with no WhatsApp scorecard is not "finished with no scorecard"', () => {
    const done = (channel) => ({ s: 'S1', q: Q(1), stage: 'child_completed', source: 'lp_v8', channel, t: iso(t - 30 * 60 * 1000) });
    expect(kinds({ children: [done('web')] })).toEqual([]);
    expect(kinds({ children: [done('')] })).toEqual(['scorecard_missing']);
    expect(W.aplFor({ env: 'production', dataset: 'niete-logs', now }).children).toMatch(/channel = tostring\(d\.channel\)/);
  });

  test('the summary says how many finished on the web page and why class cards were skipped', () => {
    const row = (stage, extra) => ({ stage, source: 'lp_v8', channel: '', choice: '', ok: '', kind: '', delivered: '', c: 0, q: 0, s: 0, n: 0, f: 0, k: 0, ...extra });
    const counts = W.streamCounts([
      row('child_joined', { c: 10, s: 10 }),
      row('child_completed', { channel: 'web', c: 8, s: 8 }),
      row('child_completed', { c: 1, s: 1 }),
      row('scorecard_sent', { ok: 'true', c: 1 }),
      row('class_cards', { c: 2, n: 0, k: 9 }),
    ]);
    expect(counts.lp).toEqual(expect.objectContaining({ completed: 9, webFinished: 8, scorecards: 1, classCards: 0, classCardSkipped: 9 }));
    const text = W.buildSummary({ label: 'Last 2 h', window: counts, today: null, other: [], incidents: [], cfg: CFG });
    expect(text).toMatch(/9 finished/);
    expect(text).toMatch(/8 on the web page/);
    expect(text).toMatch(/9 skipped/);
  });
});
