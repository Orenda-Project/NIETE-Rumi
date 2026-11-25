import { useEffect, useState } from 'react';
import type { SessionDetail } from '../../../types/portal';

/**
 * bd-ra8xu.64.3 (queue #282) — the teacher's indicator guide behind the "?" on her own Digital Coach report, as DATA
 * (language is data: every text carries its en and ur). The operator, 25 Nov: "for DC the ? needs to also be there.
 * However the descriptions, do update them to be for the teacher intended to record themselves."
 *
 * The 11 indicators the Digital Coach scores on FICO17 v6 (C1 C2 C4 C6 C8 / D1 D5 / F1 F2 F3 F4), rewritten for a
 * teacher reading the report on her own recorded lesson from Dr Rifat Yasmeen's observer manual (help/observe, left
 * unchanged for coaches and principals). Names and level labels are the rubric's. Built outside this repo (the
 * bd-ra8xu.64 work folder, workbench/make_dc_guide_ts.py) into fico_v6_dc.guide.json + .ts; the Urdu is a DRAFT for
 * native review. ~54 KB, so it loads only when the tray opens: the report page's first chunk does not carry it.
 */
export type Text = { en: string; ur: string };
/** `example` and `why` are null on a level where an example does not help her: the card shows no "Example" there. */
export type DcLevel = { n: number; text: Text; example: Text | null; why: Text | null };
export type DcItem = {
  code: string;
  name: Text;
  means: Text;
  /** "dc": the Digital Coach sets this level from her recording (all 11 today). */
  who: string | null;
  how: Text;
  levels: DcLevel[];
  tips: Text[];
  /** C2 only: when it is N/A (no child was wrong), in her words. No N/A line on the others. */
  na: { title: Text; when: Text } | null;
};
export type DcSection = { key: string; name: Text; items: DcItem[] };
export type DcGuideData = {
  id: string;
  band: string;
  audience: string;
  status: string;
  ur_status: string;
  label: Text;
  level_labels: { en: Record<string, string>; ur: Record<string, string> };
  sections: DcSection[];
  provenance: string;
};

let cache: Promise<DcGuideData> | null = null;

/** The guide, loaded once (a failed load is forgotten, so opening the tray again tries again). */
export function loadDcGuide(): Promise<DcGuideData> {
  cache ??= import('./fico_v6_dc.guide').then(
    (m) => m.default,
    (e) => { cache = null; throw e; },
  );
  return cache;
}

/** The guide: null while it loads, 'failed' when it could not (no network for the chunk). */
export function useDcGuide(): DcGuideData | null | 'failed' {
  const [guide, setGuide] = useState<DcGuideData | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    loadDcGuide().then((g) => { if (live) setGuide(g); }, () => { if (live) setGuide('failed'); });
    return () => { live = false; };
  }, []);
  return guide;
}

/**
 * Whether a report was scored on FICO17 v6. The session detail's `rubric` is the stored rubric's LABEL, not its id
 * (dashboard portal.routes.js → bot rubric-label.js rubricLabelText): "FICO17 v6", "FICO17 v6.1" (queue #218's minor
 * versions); "FICO V3", "FICO17 v5", "FICO 6-12 …" are not. The id form ("fico17_v6") is accepted too.
 */
export function isV6Rubric(rubric: string | null | undefined): boolean {
  return /^fico17[ _]v6(?![0-9])/i.test(String(rubric || '').trim());
}

/** The "?" shows on HER own Digital Coach report on v6 only: never a coach visit's (`observation`), never before it loads. */
export function showsDcGuide(detail: Pick<SessionDetail, 'rubric' | 'observation'> | null | undefined): boolean {
  return !!detail && !detail.observation && isV6Rubric(detail.rubric);
}
