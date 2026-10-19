/**
 * bd-t7zk3t.12 — the minimal STRUCTURAL shapes Share reads from m-app's plan page. They mirror (a subset of) m-app's
 * `fln/types.ts` (FlnPlan, FlnPlacement, FlnMe on branch bd-t7zk3t.11, PR-C), which is not on this branch; m-app's
 * full types are assignable to these, so the page passes its own objects straight in. Keep in step with that file.
 */
import type { ShareLang, ShareSubject } from './strings.share';

export interface ShareMe {
  share: boolean;
  ui_lang: ShareLang;
}

export interface SharePlanLike {
  id: number;
  title: string;
  lang: ShareLang;
  dir: 'ltr' | 'rtl';
  subject?: ShareSubject;
  /** m-app: `{ total: number, … }`; a bare number is accepted too. */
  minutes?: { total: number } | number;
}

export interface SharePlacementLike {
  subject: ShareSubject;
  level: 1 | 2 | 3;
  pos: number;
  count: number;
}
