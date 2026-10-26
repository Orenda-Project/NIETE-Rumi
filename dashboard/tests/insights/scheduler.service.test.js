'use strict';
/** The 02:00 PKT scheduler: off by default (B8), the next-run arithmetic, and the child process it starts. */
const { EventEmitter } = require('events');
const sch = require('../../lib/insights/scheduler');

describe('msUntilNextRun', () => {
  test('01:00 PKT → one hour', () => { expect(sch.msUntilNextRun(new Date('2026-10-26T20:00:00Z'))).toBe(3600000); });
  test('02:00 PKT exactly → the next night', () => { expect(sch.msUntilNextRun(new Date('2026-10-26T21:00:00Z'))).toBe(24 * 3600000); });
  test('15:00 PKT → eleven hours', () => { expect(sch.msUntilNextRun(new Date('2026-10-26T10:00:00Z'))).toBe(11 * 3600000); });
});

describe('start', () => {
  test('does nothing unless COACHIP_NIGHTLY=on', () => {
    const spawn = jest.fn();
    const setTimer = jest.fn();
    expect(sch.start({ env: {}, spawn, setTimer, log: () => {} })).toBe(null);
    expect(setTimer).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('on: waits until 02:00 PKT, runs the job as a child process, then schedules the next night', () => {
    const timers = [];
    const setTimer = (fn, ms) => { timers.push({ fn, ms }); return {}; };
    const child = new EventEmitter();
    const spawn = jest.fn(() => child);
    sch.start({ env: { COACHIP_NIGHTLY: 'on' }, spawn, setTimer, now: () => new Date('2026-10-26T20:00:00Z'), log: () => {} });
    expect(timers[0].ms).toBe(3600000);
    timers[0].fn();
    expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/jobs[/\\]coachip-nightly\.js$/)], expect.any(Object));
    child.emit('exit', 0);
    expect(timers).toHaveLength(2);
  });
});
