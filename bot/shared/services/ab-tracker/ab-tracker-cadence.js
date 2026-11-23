'use strict';
/**
 * When the A/B tracker refreshes (bd-3kshar.6.5.2): every 15 minutes in school hours, every 2 hours outside them
 * (Amena, 23 Nov 2026). Pure: it takes the instant, never reads the clock.
 *
 * School hours are the quiz scheduler's rule (quiz/quiz-scheduler.service.js isSchoolHours): Mon–Sat 08:00–16:00
 * Pakistan time, Friday until 12:00 (Jummah), Sunday off. This copy reads the PKT day, not the host's local day.
 *
 * A slot names one refresh: 'YYYY-MM-DDTHH:MM' (Pakistan), floored to 15 minutes in school hours and to the even
 * hour outside them. The rollup runs once per slot (its Redis marker is keyed on it).
 */
const { pktDate, pktHour, pktMinute, PKT_OFFSET_MIN } = require('../nudges/pkt-time');

const SCHOOL_SLOT_MIN = 15;
const OFF_SLOT_MIN = 120;

/** 0 = Sunday … 6 = Saturday, on the Pakistan calendar. */
const pktDay = (now) => new Date(now.getTime() + PKT_OFFSET_MIN * 60000).getUTCDay();

function isSchoolHours(now) {
  const day = pktDay(now);
  const hour = pktHour(now);
  if (day === 0) return false;
  if (day === 5) return hour >= 8 && hour < 12;
  return hour >= 8 && hour < 16;
}

const pad = (n) => String(n).padStart(2, '0');

function slotFor(now) {
  const step = isSchoolHours(now) ? SCHOOL_SLOT_MIN : OFF_SLOT_MIN;
  const minute = pktHour(now) * 60 + pktMinute(now);
  const start = minute - (minute % step);
  return `${pktDate(now)}T${pad(Math.floor(start / 60))}:${pad(start % 60)}`;
}

module.exports = { isSchoolHours, slotFor, SCHOOL_SLOT_MIN, OFF_SLOT_MIN };
