'use strict';

/**
 * Today's list as the coach reads it, and the order each class teacher gets (L25, CONTRACT §19,
 * design §3.1, R1 §7.2). Pure: takes draw.todaysList's result, returns text; sends nothing.
 *
 *   Grade 3 · 5 children
 *   Today's children, by classroom. Ask each class teacher to send them *one at a time*.
 *
 *   *Grade 3 - A* · Teacher: Saima Bibi
 *   1. Ayesha Khan
 *   2. Bilal Ahmed (father: Ahmed Raza)
 *
 *   *Grade 3 - B* · ask the head teacher for this room
 *   3. Hamza Ali
 *
 *   Only if someone is absent: Usman Ghani (3-A), Sana Iqbal (3-B)
 *
 * Each class teacher's message names only their own room's children still waiting (R1 §5: one teacher
 * used to get every room's children). A room without a reachable class teacher gets no message.
 * Every field fits its WhatsApp cap in code points: header 60, body 1024, button 20.
 */

const { gradeLabelFor } = require('../../../config/ux-strings');
const { t, clip, digits } = require('./copy');
const { nameWithHint, classLong, classShort, teacherLine, iso } = require('./identity');

const HEADER_MAX = 60;
const BODY_MAX = 1024;
const BUTTON_MAX = 20;
const INACTIVE = new Set(['absent', 'refused', 'absent_final']);
const cps = (s) => [...String(s)].length;
const comma = (lang) => (lang === 'en' ? ', ' : '، ');

/** The list's rooms in collection order: list.classes, or (older lists) the children's rooms in list order. */
function roomsOf(list) {
  const children = list.children || [];
  if (Array.isArray(list.classes) && list.classes.length) return list.classes;
  const ids = [...new Set(children.map((k) => k.classId))];
  return ids.map((id) => {
    const k = children.find((x) => x.classId === id) || {};
    return { ...k, classId: id, drawIds: children.filter((x) => x.classId === id).map((x) => x.drawId) };
  });
}

function statusText(lang, k, list) {
  if (k.status === 'tested') return t(lang, 'childTestListV2Done');
  if (k.status === 'refused') return t(lang, 'childTestListV2Refused');
  if (INACTIVE.has(k.status)) return t(lang, 'childTestListV2Absent');
  if (k.role === 'returning' && list.formPolicy === 'returning_b') return t(lang, 'childTestListV2Returning');
  return '';
}

/** A child's name as a list line, shortened only when the body would not fit. */
function nameFor(lang, k, level) {
  if (level < 2) return nameWithHint(lang, k);
  const raw = { ...k, displayName: clip(k.displayName, 28), displayNameUrdu: k.displayNameUrdu && clip(k.displayNameUrdu, 28), fatherName: k.fatherName && clip(k.fatherName, 20) };
  return nameWithHint(lang, raw);
}

function render(lang, list, level) {
  const children = list.children || [];
  const byId = new Map(children.map((k) => [k.drawId, k]));
  const lines = [t(lang, 'childTestListV2Intro')];
  const noOf = new Map(children.map((k, i) => [k.drawId, Number.isInteger(k.childNo) && k.childNo > 0 ? k.childNo : i + 1]));
  for (const room of roomsOf(list)) {
    const kids = (room.drawIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (!kids.length) continue;
    const who = teacherLine(lang, room, { firstNameOnly: level >= 1 }) || t(lang, 'childTestListV2NoTeacher');
    lines.push('', `*${classLong(lang, room) || classShort(lang, room) || ''}* · ${who}`);
    for (const k of kids) {
      const status = statusText(lang, k, list);
      lines.push(`${digits(lang, noOf.get(k.drawId))}. ${nameFor(lang, k, level)}${status ? ` · ${status}` : ''}`);
    }
  }
  const alts = (list.alternates || []).filter((k) => !INACTIVE.has(k.status));
  if (alts.length) {
    const named = alts.map((k) => {
      const short = classShort(lang, k);
      return short ? `${nameFor(lang, k, level)} (${short})` : nameFor(lang, k, level);
    });
    lines.push('', t(lang, 'childTestListV2Alternates', { children: named.join(comma(lang)) }));
  }
  return lines.join('\n');
}

/** Rooms with a class teacher and at least one child still waiting to be sent. */
function sendableRooms(list) {
  const byId = new Map((list.children || []).map((k) => [k.drawId, k]));
  return roomsOf(list)
    .map((room) => ({ room, waiting: (room.drawIds || []).map((id) => byId.get(id)).filter((k) => k && k.status === 'listed') }))
    .filter((x) => x.room.teacherUserId && String(x.room.teacherName || '').trim() && x.waiting.length);
}

/**
 * @param {'en'|'ur'} lang  the coach's language
 * @param {object} list     draw.todaysList result (children, alternates, classes, grade)
 * @returns {{header: string, body: string, buttons: Array<{id: string, title: string}>}}
 */
function buildListMessage(lang, list) {
  const active = (list.children || []).filter((k) => !INACTIVE.has(k.status)).length;
  const grade = gradeLabelFor(`grade_${list.grade}`, lang) || String(list.grade);
  const header = clip(t(lang, 'childTestListV2Header', { grade, n: active }), HEADER_MAX);
  let body = '';
  for (const level of [0, 1, 2]) {
    body = render(lang, list, level);
    if (cps(body) <= BODY_MAX) break;
  }
  body = clip(body, BODY_MAX);
  const buttons = [{ id: 'ctst_start', title: clip(t(lang, 'childTestListV2Start'), BUTTON_MAX) }];
  if (sendableRooms(list).length) buttons.push({ id: 'ctst_send_teachers', title: clip(t(lang, 'childTestListV2SendTeachers'), BUTTON_MAX) });
  return { header, body, buttons };
}

/**
 * One message per room that has a class teacher: only that room's children still waiting, numbered in
 * list order. Built in `lang` — call with each teacher's own language and pick their message.
 * @returns {Array<{teacherUserId: string, classId: string, body: string}>}
 */
function buildTeacherMessages(lang, list) {
  return sendableRooms(list).map(({ room, waiting }) => ({
    teacherUserId: room.teacherUserId,
    classId: room.classId,
    body: t(lang, 'childTestTeacherMessageRoom', {
      cls: classLong(lang, room) || classShort(lang, room) || '',
      children: waiting.map((k, i) => `${digits(lang, i + 1)}. ${nameWithHint(lang, k)}`).join('\n'),
    }),
  }));
}

module.exports = { buildListMessage, buildTeacherMessages, iso };
