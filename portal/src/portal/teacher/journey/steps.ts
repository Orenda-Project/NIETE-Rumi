/**
 * One My journey step → one HistoryRow (spec §4, UX: HistoryRow lead="glyph"): the step's neutral icon, its line, the
 * data · day under it, an optional chip, and what it opens. Read-only (the team view) → every line is information.
 * A step whose target is unknown (no plan key) is information too. The quiz line opens nothing here: its signed quiz
 * home is not part of the stored step.
 */
import {
  AudioLines, BookOpen, CircleCheck, ClipboardList, FileText, Lightbulb, ListChecks, type LucideIcon,
} from 'lucide-react';
import type { BandKey } from '../../lib/scoreBands';
import type { HistoryItem } from '../ui/HistoryList';
import { subjectShort } from '../ui/subjects';
import { openUrl } from '../lessons/paths';
import { lessonPath } from '../coaching/paths';
import { paperPath } from '../assessment/paths';
import { dayWord, type JourneyStep } from './weeks';
import type { Words } from '../i18n';
import type { JOURNEY_COPY } from './copy';

export type RowWords = {
  J: Words<typeof JOURNEY_COPY>;
  gradeShort: (g: string) => string;
  chapter: (n: number) => string;
  days: { today: string; yesterday: string; weekdaysShort: readonly string[] };
  bands: Record<BandKey, string>;
  lang: 'en' | 'ur';
};

const GLYPH: Record<string, LucideIcon> = {
  plan_opened: BookOpen, taught: CircleCheck, coached: AudioLines, report: FileText, tip: Lightbulb, quiz: ListChecks, exam: ClipboardList,
};
const GOOD_OR_BETTER: readonly string[] = ['excellent', 'good'];
const TIP_CHARS = 60;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gradeOf = (v: unknown): string | null => {
  const m = /(\d{1,2})/.exec(String(v ?? ''));
  return m ? m[1] : null;
};
const cut = (s: string) => (s.length > TIP_CHARS ? `${s.slice(0, TIP_CHARS).trimEnd()}…` : s);

function classLabel(meta: Record<string, unknown>, w: RowWords): string | null {
  const g = gradeOf(meta.grade);
  const subject = text(meta.subject);
  const parts = [g ? w.gradeShort(g) : null, subject ? subjectShort(subject, w.lang) : null].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function planLink(kind: unknown, ref: unknown, meta: Record<string, unknown>): string | undefined {
  if ((kind !== 'k5' && kind !== 'g612') || !text(ref)) return undefined;
  const g = gradeOf(meta.grade);
  return openUrl({ plan: `${kind}:${String(ref)}`, grade: g ? Number(g) : null });
}

function target(step: JourneyStep): string | undefined {
  const m = step.meta;
  switch (step.kind) {
    case 'plan_opened': return planLink(m.plan_kind, step.refId, m);
    case 'taught': return planLink(m.plan_kind, m.plan_ref, m);
    case 'coached': case 'report': case 'tip': return lessonPath(step.refId);
    case 'exam': return paperPath(step.refId);
    default: return undefined;
  }
}

function details(step: JourneyStep, w: RowWords): { parts: (string | null)[]; chip: HistoryItem['chip'] } {
  const m = step.meta;
  switch (step.kind) {
    case 'plan_opened': return { parts: [classLabel(m, w)], chip: null };
    case 'taught': return { parts: [classLabel(m, w), text(m.topic)], chip: null };
    case 'coached': return { parts: [text(m.topic)], chip: null };
    case 'report': {
      const band = typeof m.band === 'string' && m.band in w.bands ? (m.band as BandKey) : null;
      return {
        parts: [text(m.topic), m.opened_at ? w.J.opened : null],
        chip: band ? { text: w.bands[band], tone: GOOD_OR_BETTER.includes(band) ? 'done' : 'waiting' } : null,
      };
    }
    case 'tip': return { parts: [text(m.text) ? cut(text(m.text) as string) : null], chip: null };
    case 'quiz': {
      const n = typeof m.played === 'number' && m.played > 0 ? m.played : null;
      return { parts: [text(m.topic)], chip: n ? { text: w.J.played(n), tone: 'info' } : null };
    }
    case 'exam': return { parts: [classLabel(m, w), typeof m.chapter === 'number' ? w.chapter(m.chapter) : null], chip: null };
    default: return { parts: [], chip: null };
  }
}

export function stepRow(step: JourneyStep, now: number, w: RowWords, { readOnly = false } = {}): HistoryItem {
  const { parts, chip } = details(step, w);
  const to = readOnly ? undefined : target(step);
  const title = (w.J.steps as Record<string, string>)[step.kind] ?? '';
  return {
    id: `${step.kind}:${step.refId}:${step.at}`,
    lead: 'glyph',
    glyph: GLYPH[step.kind] ?? BookOpen,
    title,
    extra: [...parts, dayWord(step.at, now, w.days)].filter(Boolean).join(' · '),
    chip,
    to,
    action: to ? 'chevron' : 'none',
  };
}
