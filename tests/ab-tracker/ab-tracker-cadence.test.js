'use strict';
// bd-3kshar.6.5.2 — the tracker refreshes every 15 minutes in school hours and every 2 hours
// outside them (Amena, 23 Nov 2026). School hours are the quiz scheduler's rule:
// Mon–Sat 08:00–16:00 PKT, Friday until 12:00, Sunday off.
const { isSchoolHours, slotFor } = require('../../bot/shared/services/ab-tracker/ab-tracker-cadence');

const AT = (hhmm, date) => new Date(`${date}T${hhmm}:00+05:00`);
const SAT = '2026-11-21';
const FRI = '2026-11-20';
const SUN = '2026-11-22';
const MON = '2026-11-23';

describe('isSchoolHours', () => {
  test('Saturday 08:00–15:59 is school time', () => {
    expect(isSchoolHours(AT('08:00', SAT))).toBe(true);
    expect(isSchoolHours(AT('15:59', SAT))).toBe(true);
  });
  test('before 08:00 and from 16:00 is not', () => {
    expect(isSchoolHours(AT('07:59', MON))).toBe(false);
    expect(isSchoolHours(AT('16:00', MON))).toBe(false);
  });
  test('Friday ends at 12:00', () => {
    expect(isSchoolHours(AT('11:59', FRI))).toBe(true);
    expect(isSchoolHours(AT('12:00', FRI))).toBe(false);
  });
  test('Sunday is never school time', () => {
    expect(isSchoolHours(AT('10:00', SUN))).toBe(false);
  });
  test('uses the PKT day, not the host day: 02:00 PKT Monday is Sunday 21:00 UTC', () => {
    expect(isSchoolHours(AT('09:00', MON))).toBe(true);
    expect(isSchoolHours(new Date('2026-11-22T21:00:00Z'))).toBe(false);
  });
});

describe('slotFor', () => {
  test('school hours: a 15-minute slot', () => {
    expect(slotFor(AT('10:00', SAT))).toBe(`${SAT}T10:00`);
    expect(slotFor(AT('10:14', SAT))).toBe(`${SAT}T10:00`);
    expect(slotFor(AT('10:20', SAT))).toBe(`${SAT}T10:15`);
    expect(slotFor(AT('15:59', SAT))).toBe(`${SAT}T15:45`);
  });
  test('off hours: a 2-hour slot on the even PKT hour', () => {
    expect(slotFor(AT('03:40', SAT))).toBe(`${SAT}T02:00`);
    expect(slotFor(AT('12:30', FRI))).toBe(`${FRI}T12:00`);
    expect(slotFor(AT('17:10', MON))).toBe(`${MON}T16:00`);
    expect(slotFor(AT('23:59', SUN))).toBe(`${SUN}T22:00`);
  });
  test('the slot date is the PKT date', () => {
    expect(slotFor(new Date('2026-11-22T20:30:00Z'))).toBe(`${MON}T00:00`);
  });
});
