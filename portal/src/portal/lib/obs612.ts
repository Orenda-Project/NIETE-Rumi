/**
 * bd-pni007 — an FDE (obs612) coach visit as the API sends it: the bot's portalSummary
 * (bot/shared/services/observe/obs612/view.js), attached as `obs612` to a leader_observation row and null on every
 * other one. Everything in it is data: FDE's own wording (English, as FDE printed it), our short tool names, the result
 * FDE's tool gives (the English & Urdu tool a %, the General form Yes counts, the Maths & Science tool levels only) and
 * the label 'FDE v1'. It is never a FICO score, so a page shows it instead of the FICO numbers, never beside them.
 */

export type Obs612Tool = "enur" | "msci" | "gen";

export type Obs612Row = { name: string; value: string; pct: number | null; full?: string };

/** The full block (an observation page, a report page). */
export type Obs612Summary = {
  label: string;
  rubric: string;
  tool: Obs612Tool;
  toolName: string;
  toolTitle: string;
  grade: number | null;
  subject: string | null;
  result: string;
  /** The Maths & Science tool and the General form: FDE gives no total. */
  noTotal: boolean;
  headline: string;
  rows: Obs612Row[];
  feedback: { label: string; text: string }[];
  footer: string;
};

/** A list row's part of it (GET /coach/reports). */
export type Obs612Line = Pick<Obs612Summary, "label" | "toolName" | "result">;

/** "English & Urdu tool · 73.6% · Proficient · FDE v1": the tool, its result and the label, for a row's second line. */
export function obs612Line(o: Obs612Line): string {
  return [o.toolName, o.result, o.label].filter(Boolean).join(" · ");
}
