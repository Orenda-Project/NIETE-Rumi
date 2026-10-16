'use strict';
/**
 * bd-v0toag.32 — the weekly report's calendar: which PKT week a send instant reports on, and whether
 * this instant is inside the Saturday-morning send window. Pinned instants only (PKT = UTC+5).
 */

const { weekOf, inSendWindow, SEND_HOUR, LAST_SEND_HOUR } = require('../../../shared/services/coaching/weekly-report/week');

describe('weekOf — the Monday-to-Friday PKT week a Saturday send reports on', () => {
  test('Saturday 09:30 PKT reports the Monday-Friday just gone', () => {
    const w = weekOf(new Date('2026-10-17T04:30:00Z')); // Sat 17 Oct 09:30 PKT
    expect(w).toEqual({
      weekStart: '2026-10-12',
      lastDay: '2026-10-16',
      fromIso: '2026-10-11T19:00:00.000Z', // Mon 12 Oct 00:00 PKT
      toIso: '2026-10-16T19:00:00.000Z', // Sat 17 Oct 00:00 PKT
    });
  });

  test('19:30 UTC on Sunday is already Monday in Pakistan, so it starts the next week', () => {
    expect(weekOf(new Date('2026-10-18T19:30:00Z')).weekStart).toBe('2026-10-19');
  });

  test('a Sunday still belongs to the week that began the Monday before', () => {
    expect(weekOf(new Date('2026-10-18T06:00:00Z')).weekStart).toBe('2026-10-12');
  });

  test('a week that crosses a month end keeps both dates right', () => {
    const w = weekOf(new Date('2026-11-01T05:00:00Z')); // Sun 1 Nov PKT
    expect(w.weekStart).toBe('2026-10-26');
    expect(w.lastDay).toBe('2026-10-30');
  });
});

describe('inSendWindow — Saturday, 09:00 up to the 21:00 quiet hours, PKT', () => {
  test('the window edges', () => {
    expect(SEND_HOUR).toBe(9);
    expect(LAST_SEND_HOUR).toBe(20);
    expect(inSendWindow(new Date('2026-10-17T03:59:00Z'))).toBe(false); // Sat 08:59
    expect(inSendWindow(new Date('2026-10-17T04:00:00Z'))).toBe(true); //  Sat 09:00
    expect(inSendWindow(new Date('2026-10-17T15:59:00Z'))).toBe(true); //  Sat 20:59
    expect(inSendWindow(new Date('2026-10-17T16:00:00Z'))).toBe(false); // Sat 21:00
  });

  test('never on any other day', () => {
    expect(inSendWindow(new Date('2026-10-16T05:00:00Z'))).toBe(false); // Fri 10:00
    expect(inSendWindow(new Date('2026-10-18T05:00:00Z'))).toBe(false); // Sun 10:00
  });
});
