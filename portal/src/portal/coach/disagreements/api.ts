import api from "../../services/api";
import { readConfigShared } from "../../lib/useNewUi";

/**
 * bd-tbprit.3 — the coach's disagreements (dashboard/routes/coach-disagreements.routes.js): the C/D teachers who
 * answered "Not accurate" to their coaching report. The API shapes are the server's; nothing is reshaped here.
 *
 * The clip is streamed by the server for the request's own coach (the session cookie rides along); the page only
 * points the kit player at it. There is no download link.
 */

export type ReasonCode = "score" | "missed" | "wont_work" | "unclear";
/** bd-tbprit.7 — the prototype's three tags, numbers included; the server decides which apply. */
export type Tag =
  | { kind: "recordingLess"; before: number; now: number }
  | { kind: "waiting"; days: number }
  | { kind: "repeat"; nth: number }
  /** bd-tbprit.9 — recorded, under 15 minutes. */
  | { kind: "short"; minutes: number };

export type Row = {
  id: string; teacher: string | null; school: string | null; emis: string | null; opened: boolean; reasons: ReasonCode[];
  status: string; done: boolean; createdAt: string; visitedAt: string | null; sessionDate: string | null; pct: number | null; hasNote: boolean; tags: Tag[];
};
export type List = { success: boolean; todo: Row[]; done: Row[] };

export type Item = { id: string; name: string; score: number | null; evidence: string | null; at: number | null; applicable: boolean };
export type Thing = { text: string; why: string | null; step: string | null };
export type Move = {
  id: string; text: string; phase: string | null; mustHappen: boolean; verdict: string | null; evidence: string | null;
  translation: string | null; why: string | null; at: number | null;
};
export type Evidence =
  | { code: "score"; items: Item[] }
  | { code: "missed"; noPlan: boolean; moves: Move[]; items: Item[] }
  | { code: "wont_work" | "unclear"; thing: Thing | null };
export type Indicator = { key: string; score: number | null; max: number | null; counted: boolean; items: Item[] };
export type Section = {
  key: string; name: string; score: number | null; max: number | null; pct: number | null; colour: string; notAssessed: boolean; why: string | null;
};
export type View = {
  language: string;
  header: { name: string | null; meta: string | null; date: string | null; pct: number | null; marks: number | null; max: number | null };
  wells: string[];
  thing: Thing | null;
  sections: Section[];
  journey: { points: number[]; first: number; best: number; now: number } | null;
  quizMessage: string | null;
  voice: unknown;
  report: unknown;
};
export type Card = {
  id: string; teacher: string | null; school: string | null; emis: string | null; group: string | null; nth: number; language: string; status: string; done: boolean;
  reasons: ReasonCode[]; createdAt: string; noteUrl: string | null; view: View; evidence: Evidence[];
  indicators: Indicator[]; moves: Move[] | null;
  /** bd-tbprit.9 — how long the recording is; null when the session does not say. */
  durationSec: number | null;
  /** bd-tbprit.10 — Rifat's "Is this a pattern?" (dashboard/services/coach-disagreement-pattern.js). */
  pattern: Pattern | null;
};
/** Her last lessons up to this one, oldest first. A null is "the server does not have it", never zero. */
export type Pattern = {
  points: { pct: number; date: string }[]; avg: number | null; best: { pct: number; date: string } | null; now: number | null;
  count: number; perWeek: number | null; level: "active" | "steady" | "atRisk" | null; ictAvg: number;
  firstDate: string | null; lastDate: string | null;
  /** The step most missed in this lesson, counted over her last 5 plan-checked lessons; null = plan not checked. */
  missed: { step: string | null; n: number; of: number } | null;
  earlier: number;
};

const path = (id: string) => `/coach/disagreements/${encodeURIComponent(id)}`;

export const disagreements = {
  async list(): Promise<List> {
    return (await api.get("/coach/disagreements")).data;
  },
  async card(id: string): Promise<Card> {
    return (await api.get(path(id))).data.card;
  },
  /** "✓ Mark as done" (bd-tbprit.12): true once the server has it. A failed save is false, never thrown. */
  async visited(id: string): Promise<boolean> {
    try {
      const { data } = await api.post(`${path(id)}/visited`);
      return data?.success === true;
    } catch {
      return false;
    }
  },
  /** "Move back to To do" (bd-tbprit.12): undoes Done. Same contract as visited. */
  async undone(id: string): Promise<boolean> {
    try {
      const { data } = await api.post(`${path(id)}/undone`);
      return data?.success === true;
    } catch {
      return false;
    }
  },
  /**
   * The disputed moment, cut on the server. Without `to`, `at` is the grader's second (the server adds the
   * lead-in); with it (bd-tbprit.9), exactly the part from `at` to `to`.
   */
  clipUrl(id: string, at: number, to?: number): string {
    const end = to == null ? "" : `&to=${Math.floor(to)}`;
    return `${api.defaults.baseURL ?? ""}${path(id)}/clip?at=${Math.max(0, Math.floor(at))}${end}`;
  },
};

/** coach_disagreement_card for THIS coach. Fail-closed: only a real true is on. */
export function readDisagreementsOn(): Promise<boolean> {
  return readConfigShared().then((cfg) => cfg?.features?.coachDisagreements === true).catch(() => false);
}
