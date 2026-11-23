/**
 * ICT sheet, Assessment Generator rows 6-7 (bd-zrdvmi.24): what the editor shows about the paper as it stands —
 * each Bloom's level's share of the questions, and how many of each question type. Pure: the editor passes the
 * questions still on the paper. Editor-only words; the printed paper never carries them.
 */

export const BLOOM_ORDER = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'] as const;
export type Bloom = (typeof BLOOM_ORDER)[number];

const SPELLINGS: Record<string, Bloom> = Object.fromEntries([
  ...BLOOM_ORDER.map((b) => [b.toLowerCase(), b]),
  ['analyse', 'Analyze'],
]);

/** The bot's `blooms` tag as one of the six levels, or null when there is none we know. */
export function bloomOf(raw: string | null | undefined): Bloom | null {
  return SPELLINGS[String(raw ?? '').trim().toLowerCase()] ?? null;
}

export type SummaryRow = { type: string; blooms?: string | null };
export type EditSummary = {
  /** Levels in Bloom's order, then untagged (level null); empty when no question has a level. */
  levels: { level: Bloom | null; count: number; pct: number }[];
  types: { type: string; count: number }[];
};

export function editSummary(rows: SummaryRow[]): EditSummary {
  const byLevel = new Map<Bloom | null, number>();
  const byType = new Map<string, number>();
  for (const r of rows) {
    const b = bloomOf(r.blooms);
    byLevel.set(b, (byLevel.get(b) ?? 0) + 1);
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  }
  const tagged = rows.length - (byLevel.get(null) ?? 0);
  const pct = (n: number) => Math.round((n / rows.length) * 100);
  const levels = tagged === 0 ? [] : [...BLOOM_ORDER, null]
    .filter((l) => byLevel.has(l))
    .map((level) => ({ level, count: byLevel.get(level)!, pct: pct(byLevel.get(level)!) }));
  return { levels, types: [...byType].map(([type, count]) => ({ type, count })) };
}
