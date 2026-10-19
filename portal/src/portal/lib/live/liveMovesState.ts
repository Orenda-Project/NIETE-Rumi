// bd-v0toag.31 — live moves: what the screen shows while a D teacher records. Pure, no I/O.
//
//  · a tick (the detector heard the move) only ever adds: nothing unticks a move;
//  · her tap ("I did this" / "I didn't") is kept with whether the move was ticked at that moment,
//    and changes neither the tick nor `now`;
//  · `now` is the first unticked move after her last ticked one. When nothing has been ticked for
//    longer than that move's section minutes, the lesson clock (sections' cumulative minutes) moves
//    it forward to the section she should be in — never back behind her ticks.

import type { LiveCard, LiveMovesRecord, LiveMovesTap } from "../../services/api";

export type MoveView = {
  idx: number; sec: string; chip: string; do: string; say: string; covers: string[];
  ticked: boolean; tickedAtMs: number | null; lastTap: 'did' | 'did_not' | null;
};
export type LiveState = {
  lessonId: string; stamp: string | null;
  sections: { sec: string; minutes: number }[];
  moves: MoveView[];
  taps: LiveMovesTap[];
};

const MIN = 60_000;

export function initState(card: LiveCard): LiveState {
  return {
    lessonId: card.lessonId,
    stamp: card.stamp ?? null,
    sections: card.sections.map((s) => ({ sec: s.sec, minutes: s.minutes })),
    moves: card.sections.flatMap((s) => s.moves.map((m) => ({
      idx: m.idx, sec: s.sec, chip: m.chip, do: m.do, say: m.say, covers: m.covers,
      ticked: false, tickedAtMs: null, lastTap: null,
    }))),
    taps: [],
  };
}

export function applyTicks(s: LiveState, idx: number[], atMs: number): LiveState {
  const hit = new Set(idx);
  return {
    ...s,
    moves: s.moves.map((m) => (!m.ticked && hit.has(m.idx) ? { ...m, ticked: true, tickedAtMs: atMs } : m)),
  };
}

export function applyTap(
  s: LiveState, idx: number, choice: 'did' | 'did_not', at: string,
): { state: LiveState; tap: LiveMovesTap } {
  const move = s.moves.find((m) => m.idx === idx);
  const tap: LiveMovesTap = { idx, choice, at, live_state: move && move.ticked ? 'ticked' : 'unticked' };
  return {
    state: { ...s, moves: s.moves.map((m) => (m.idx === idx ? { ...m, lastTap: choice } : m)), taps: [...s.taps, tap] },
    tap,
  };
}

/** The section the lesson clock puts her in at `elapsedMs` (the last one once the clock runs past the lesson). */
function clockSection(s: LiveState, elapsedMs: number): string {
  let end = 0;
  for (const sec of s.sections) {
    end += sec.minutes * MIN;
    if (elapsedMs < end) return sec.sec;
  }
  return s.sections[s.sections.length - 1].sec;
}

export function nowIndex(s: LiveState, elapsedMs: number): number | null {
  const moves = s.moves;
  let lastTicked = -1;
  let lastTickAt = 0;
  moves.forEach((m, i) => {
    if (!m.ticked) return;
    lastTicked = i;
    lastTickAt = Math.max(lastTickAt, m.tickedAtMs ?? 0);
  });
  let at = moves.findIndex((m, i) => i > lastTicked && !m.ticked);
  if (at < 0) at = moves.findIndex((m) => !m.ticked);
  if (at < 0) return null;

  const minutes = s.sections.find((sec) => sec.sec === moves[at].sec)?.minutes ?? 0;
  if (elapsedMs - lastTickAt > minutes * MIN) {
    const start = moves.findIndex((m) => m.sec === clockSection(s, elapsedMs));
    const byClock = moves.findIndex((m, i) => i >= start && !m.ticked);
    if (byClock > at) at = byClock;
  }
  return moves[at].idx;
}

export function untickedIdx(s: LiveState): number[] {
  return s.moves.filter((m) => !m.ticked).map((m) => m.idx);
}

export function toRecord(
  s: LiveState, meta: { liveId: string; drops: number; bytesSent: number },
): LiveMovesRecord {
  return {
    lessonId: s.lessonId,
    stamp: s.stamp,
    liveId: meta.liveId,
    moves: s.moves.map((m) => ({ idx: m.idx, covers: m.covers, tickedAtMs: m.tickedAtMs })),
    taps: s.taps,
    drops: meta.drops,
    bytesSent: meta.bytesSent,
  };
}
