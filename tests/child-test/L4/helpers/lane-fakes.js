/**
 * In-memory stand-ins for the other lanes' modules, implementing the PUBLISHED contracts:
 *   draw + store  — lanes/L3/STORE_API.md (never throw, { ok, ... } results)
 *   scoring       — CONTRACT §5 scoreBlock({ sessionId, block, grade, form }) → { ok, aiStatus }
 *   checkFlow     — CONTRACT §5 sendCheck(sessionId)
 *   render        — L2 renderInlineCards({ grade, form, block, variant }) → [{ png, text, part }]
 *   itemBank      — CONTRACT §2 accessor (cue phrases)
 * They are injected through conversation/ports.js because those modules are not on this branch
 * yet (L4 REPORT lists which stubs remain). Everything of L4's own runs for real.
 */

function makeChildren(n, start = 1, role = 'new') {
  return Array.from({ length: n }, (_, i) => ({
    drawId: `d${start + i}`, studentId: `s${start + i}`, rollNumber: String(start + i), classId: 'class-3a', section: 'A',
    displayName: `Child 3A-${String(start + i).padStart(2, '0')}`, role, form: role === 'returning' ? 'B' : 'A', status: 'listed', attempts: 0,
  }));
}

function createLaneFakes({ noClassList = false } = {}) {
  const calls = [];
  const lists = {};          // visitId → list
  const sessions = {};       // id → session
  const blocks = {};         // `${sessionId}:${block}` → block
  let nextSession = 1;
  const fail = { createSession: false, attachBlockMedia: false, markOutcome: false };

  const freshList = () => {
    const children = [...makeChildren(4, 1), ...makeChildren(1, 5, 'returning')];
    return { ok: true, cycleId: 'ICT-2026-Q4', grade: 3, classId: 'class-3a', classIds: ['class-3a'], gradeFallback: false,
      children, alternates: makeChildren(2, 6), reused: false };
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const draw = {
    async todaysList(args) {
      calls.push(['todaysList', args]);
      if (noClassList) return { ok: false, reason: 'no_class_list', grade: 3 };
      if (!args.visitId) return { ok: false, reason: 'missing_visit' };   // L3: visitId is required (FK to observation_field_forms)
      const key = args.visitId;
      if (!lists[key]) lists[key] = freshList(); else lists[key].reused = true;
      return clone(lists[key]);
    },
    async markOutcome(args) {
      calls.push(['markOutcome', args]);
      if (fail.markOutcome) return { ok: false, error: 'db down' };
      const list = Object.values(lists).find((l) => l.children.some((c) => c.drawId === args.drawId));
      if (!list) return { ok: false, reason: 'not_on_list' };
      const idx = list.children.findIndex((c) => c.drawId === args.drawId);
      const child = list.children[idx];
      if (child.status !== 'listed') return { ok: false, reason: 'already_marked' };
      if (args.outcome === 'present') child.status = 'tested';
      else {
        // As L3: the child stays on the main list, marked; the first alternate joins it, and the
        // main list is ordered new-before-returning, then by rank.
        child.status = args.outcome;
        const promoted = list.alternates.shift();
        if (promoted) list.children.push(promoted);
        const n = (c) => Number(c.drawId.slice(1));
        list.children.sort((a, b) => (a.role === b.role ? n(a) - n(b) : a.role === 'new' ? -1 : 1));
      }
      return { ok: true, list: clone(list) };
    },
    async resolveVisitSchool(args) {
      calls.push(['resolveVisitSchool', args]);
      return { ok: true, schoolId: 'school-1' };
    },
  };

  const store = {
    async createSession(args) {
      calls.push(['createSession', args]);
      if (fail.createSession) return { ok: false, error: 'insert failed' };
      const existing = Object.values(sessions).find((s) => s.draw_id === args.drawId);
      if (existing) return { ok: true, session: clone(existing), created: false };
      const id = `sess-${nextSession++}`;
      sessions[id] = { id, draw_id: args.drawId, coach_user_id: args.coachUserId, visit_id: args.visitId, school_id: 'school-1',
        class_id: 'class-3a', grade: 3, student_id: `s${args.drawId.slice(1)}`, form: args.drawId === 'd5' ? 'B' : 'A',
        channel: args.channel, status: 'in_progress', timings: {} };
      return { ok: true, session: clone(sessions[id]), created: true };
    },
    async getSession(id) { return { ok: true, session: sessions[id] ? clone(sessions[id]) : null }; },
    async getSessionByDraw(drawId) {
      const s = Object.values(sessions).find((x) => x.draw_id === drawId);
      return { ok: true, session: s ? clone(s) : null };
    },
    async listSessionsForVisit(visitId) {
      return { ok: true, sessions: Object.values(sessions).filter((s) => s.visit_id === visitId).map(clone) };
    },
    async setSessionStatus(id, status) {
      calls.push(['setSessionStatus', id, status]);
      if (!sessions[id]) return { ok: false, error: 'no session' };
      sessions[id].status = status; return { ok: true, session: clone(sessions[id]) };
    },
    async recordTiming(id, key, at = new Date()) {
      calls.push(['recordTiming', id, key]);
      const s = sessions[id]; if (!s) return { ok: false, error: 'no session' };
      if (!s.timings[key]) s.timings[key] = new Date(at).toISOString();
      return { ok: true, timings: clone(s.timings) };
    },
    async attachBlockMedia(args) {
      calls.push(['attachBlockMedia', args]);
      if (fail.attachBlockMedia) return { ok: false, error: 'update failed' };
      const k = `${args.sessionId}:${args.block}`;
      const b = blocks[k] || (blocks[k] = { session_id: args.sessionId, block: args.block, ai_marks: null, checked_at: null });
      if (b.ai_marks) return { ok: false, alreadyScored: true };
      if (args.audioR2Key) b.audio_r2_key = args.audioR2Key;
      if (args.photoR2Key) b.photo_r2_key = args.photoR2Key;
      return { ok: true, block: clone(b) };
    },
    async listBlocks(sessionId) {
      return { ok: true, blocks: Object.values(blocks).filter((b) => b.session_id === sessionId).map(clone) };
    },
  };

  const scoring = {
    async scoreBlock(args) {
      calls.push(['scoreBlock', args]);
      const b = blocks[`${args.sessionId}:${args.block}`];
      if (b) b.ai_marks = { version: 'ai-marks-v1' };
      return { ok: true, aiStatus: 'scored' };
    },
  };

  const checkFlow = {
    result: true,
    async sendCheck(sessionId) { calls.push(['sendCheck', sessionId]); return checkFlow.result; },
  };

  const render = {
    async renderInlineCards(args) {
      calls.push(['renderInlineCards', args]);
      return [
        { part: 'story', index: 1, png: Buffer.from('png1'), text: 'story line one' },
        { part: 'story', index: 2, png: Buffer.from('png2'), text: 'story line two' },
      ];
    },
  };

  const itemBank = {
    version: 'child-test-items-v1',
    cue: () => ({ urdu: { start: 'شروع' }, english: { start: 'start' }, maths: { start: 'اب سوال شروع کریں', numbers: 'اب یہ نمبر باری باری پڑھیں' } }),
  };

  return { draw, store, scoring, checkFlow, render, itemBank, calls, sessions, blocks, lists, fail };
}

module.exports = { createLaneFakes };
