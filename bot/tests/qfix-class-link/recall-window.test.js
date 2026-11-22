'use strict';
/**
 * Each miss is brought back ONCE. A round on school day R recalls the finishes of the calendar days after
 * (P - 2) up to and including (R - 2), P being the school day before R. So every calendar day belongs to exactly one
 * round: Monday's takes Thursday, Friday and Saturday; Tuesday's takes Sunday; Wednesday's Monday; Thursday's Tuesday;
 * Friday's Wednesday. Before, every round took R-3..R-2: a miss came back on two rounds in a row (a Saturday miss on
 * Monday AND Tuesday), and a Thursday miss on none (its R-2 and R-3 rounds fall on the weekend).
 * Pure: no boundary to fake.
 */
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');

const pkt = (day) => new Date(`${day}T00:00:00+05:00`).toISOString();

test('Tuesday 24 Nov: Sunday only', () => {
  expect(Recall.missWindow('2026-11-24')).toEqual({ from: pkt('2026-11-22'), to: pkt('2026-11-23') });
});

test('Monday 23 Nov: Thursday, Friday and Saturday', () => {
  expect(Recall.missWindow('2026-11-23')).toEqual({ from: pkt('2026-11-19'), to: pkt('2026-11-22') });
});

test('Wednesday 25 Nov: Monday; Friday 27 Nov: Wednesday', () => {
  expect(Recall.missWindow('2026-11-25')).toEqual({ from: pkt('2026-11-23'), to: pkt('2026-11-24') });
  expect(Recall.missWindow('2026-11-27')).toEqual({ from: pkt('2026-11-25'), to: pkt('2026-11-26') });
});

test('three weeks of school days: the windows tile the calendar, no day twice, no day missed', () => {
  const days = [];
  for (let d = new Date(Date.UTC(2026, 10, 2)); d < Date.UTC(2026, 10, 30); d = new Date(d.getTime() + 864e5)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) days.push(iso);
  }
  const w = days.map((r) => Recall.missWindow(r));
  for (let i = 1; i < w.length; i += 1) expect(w[i].from).toBe(w[i - 1].to);
  w.forEach((x) => expect(Date.parse(x.to)).toBeGreaterThan(Date.parse(x.from)));
});
