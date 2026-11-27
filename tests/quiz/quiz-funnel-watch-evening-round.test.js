'use strict';
/**
 * bd-nmtlgs — #niete-lp-quiz-alerts, 26–27 Nov 2026: "Lesson plans — made but never sent" for 26 quizzes
 * (5766889e, eb14b609 …) and "class report owed" for e09068b5. Every one was a class's EVENING ROUND
 * (quizzes.meta.source 'evening_round', web-quiz-evening-round.js): it emits quiz_funnel.generated into the
 * lesson-plan stream but by design sends nothing to the teacher and has no class report — children reach it
 * through the class's standing link. Its row stays status 'ready' for ever, so the DB confirmation kept it.
 * A round is never owed a send or a report: the confirmation drops it.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const W = require('../../bot/shared/services/monitoring/quiz-funnel-watch.service');

const MIN = 60 * 1000;
const H = 60 * MIN;
const now = new Date(Date.UTC(2026, 10, 27, 9, 33));
const t = now.getTime();
const iso = (ms) => new Date(ms).toISOString();
const CFG = W.config({});
const Q = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const C = (n) => `${String(n).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const made = (q, ago) => ({ q, stage: 'generated', source: 'lp_v8', t: iso(t - ago), reasons: [] });
const joined = (q, sc, ago) => ({ q, sc, stage: 'child_joined', source: 'lp_v8', kind: '', t: iso(t - ago) });

// One round and one ordinary teacher quiz, both made 30 min ago and never sent; both read 'ready'.
const query = async (name) => {
  if (name === 'lifecycle') return [made(Q(1), 30 * MIN), made(Q(2), 30 * MIN)];
  if (name === 'reports') return [joined(Q(1), C(1), 23 * H), joined(Q(2), C(2), 23 * H)];
  return [];
};
const rows = [
  { id: Q(1), status: 'ready', source: 'evening_round' },
  { id: Q(2), status: 'ready', source: 'home' },
];

describe('an evening round is never owed a send or a report', () => {
  test('the round is dropped from "made but never sent" and "report owed"; the teacher quiz stays', async () => {
    const { incidents } = await W.buildReport({
      now, env: 'production', dataset: 'niete-logs', cfg: CFG, query, confirm: async (ids) => rows.filter((r) => ids.includes(r.id)),
    });
    const ids = (kind) => (incidents.find((i) => i.kind === kind) || { ids: [] }).ids;
    expect(ids('send_stall')).toEqual([Q(2)]);
    expect(ids('report_owed')).toEqual([Q(2)]);
  });

  test('only rounds: no incident at all, so the stream is not called stalled', async () => {
    const { incidents } = await W.buildReport({
      now, env: 'production', dataset: 'niete-logs', cfg: CFG, query,
      confirm: async (ids) => ids.map((id) => ({ id, status: 'ready', source: 'evening_round' })),
    });
    expect(incidents.filter((i) => i.kind === 'send_stall' || i.kind === 'report_owed')).toEqual([]);
    expect(W.verdictFor({ made: 2, sent: 0 }, incidents, 'lp')).not.toBe('stalled');
  });

  test('the confirmation read brings back where the quiz came from', async () => {
    const asked = {};
    jest.isolateModules(() => {
      jest.doMock('../../bot/shared/config/supabase', () => ({
        from: () => ({ select: (cols) => { asked.cols = cols; return { in: async () => ({ data: [], error: null }) }; } }),
      }));
      require('../../bot/shared/services/monitoring/quiz-funnel-watch.service').confirmFromDb([Q(1)]);
    });
    await Promise.resolve();
    expect(asked.cols).toMatch(/source:meta->>source/);
  });
});
