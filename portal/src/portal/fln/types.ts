/**
 * The shapes the FLN pages read (contracts/api.md v2, contracts/plan-json.md v2, r-data FLN_PLAN_SHAPE).
 * Server-owned; the client never derives a number (position, count, minutes) on its own.
 */
import type { FlnLang, FlnSubjectKey, GroupLevel, ItemKind, Strand } from './strings';

export interface FlnMe {
  lessons: boolean;
  share: boolean;
  role: string | null;
  ui_lang: FlnLang;
}

export interface FlnChips {
  sounds?: number;
  words?: number;
  narration?: boolean;
  video?: boolean;
  textbook?: boolean;
  additional?: boolean;
  screener?: boolean;
  guide?: boolean;
}

export interface FlnRow {
  id: number;
  title: string;
  lang: FlnLang;
  dir: 'ltr' | 'rtl';
  minutes: number;
  chips: FlnChips;
  opened: boolean;
  pos: number;
  count: number;
  label?: 'additional_practice' | 'needs_textbook' | 'screener' | 'guide' | null;
  note_en?: string | null;
  note_ur?: string | null;
}

export interface FlnChapter {
  chapter_no: number;
  title_en?: string | null;
  title_ur?: string | null;
  plans: FlnRow[];
}

export interface FlnStrandBlock {
  strand: Strand;
  chapters: FlnChapter[];
}

export interface FlnLevel {
  level: 1 | 2 | 3;
  label_en?: string;
  label_ur?: string;
  desc_en?: string;
  desc_ur?: string;
  grades: number[];
  count: number;
  screener_id?: number | null;
  screener_minutes?: number | null;
  /** The screener has audio (sounds, words or narration): only then the "Answer key audio" chip. */
  screener_audio?: boolean;
  note_en?: string | null;
  note_ur?: string | null;
}

export interface FlnCatalogue {
  subject: { key: FlnSubjectKey; name_en?: string; name_ur?: string; lang: FlnLang; dir: 'ltr' | 'rtl' };
  grade: number;
  level: 1 | 2 | 3 | null;
  levels: FlnLevel[];
  strands: FlnStrandBlock[];
}

export interface FlnMedia {
  kind: 'audio' | 'image' | 'video' | 'pdf';
  src: string;
  orig?: string;
  bytes?: number;
  ok?: boolean;
  duration_s?: number;
  w?: number;
  h?: number;
  full?: string;
  poster?: string;
  src_low?: string;
  label?: string;
  label_en?: string;
  label_ur?: string;
  caption_en?: string;
  caption_ur?: string;
  role?: 'sound' | 'word' | 'narration';
  sha8?: string;
}

export interface FlnItem {
  kind: ItemKind;
  text: string;
  media: FlnMedia[];
}

export interface FlnGroup {
  header: string | null;
  level: GroupLevel | null;
  items: FlnItem[];
}

export interface FlnSection {
  kind: 'opening' | 'explain' | 'practice' | 'independent_practice' | 'conclusion';
  minutes?: number;
  groups: FlnGroup[];
}

export interface FlnPlan {
  id: number;
  key: string;
  subject: FlnSubjectKey;
  lang: FlnLang;
  dir: 'ltr' | 'rtl';
  title: string;
  slo: string[];
  resources: string[];
  minutes: { total: number } & Partial<Record<FlnSection['kind'], number>>;
  sections: FlnSection[];
  videos?: FlnMedia[];
  setup?: FlnItem[];
  homework?: FlnItem[];
  summary?: FlnItem[];
  programme?: 'p25' | 'p23';
  audio_summary?: { sounds: number; words: number; narration: boolean };
}

export interface FlnPlacement {
  subject: FlnSubjectKey;
  level: 1 | 2 | 3;
  grades: number[];
  /** The grade whose list holds the lesson at this `pos`/`count` (a level's two grades can differ). */
  grade?: number | null;
  strand: Strand;
  chapter_title_en?: string | null;
  chapter_title_ur?: string | null;
  pos: number;
  count: number;
  label?: FlnRow['label'];
}

export interface FlnPlanResponse {
  plan: FlnPlan;
  placement: FlnPlacement[];
}
