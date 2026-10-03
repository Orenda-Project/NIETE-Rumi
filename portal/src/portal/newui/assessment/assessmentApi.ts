import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Calculator, CaseSensitive, FlaskConical, Globe, Languages, Lightbulb, MoonStar } from 'lucide-react';
import { isNativeApp } from '@/lib/runtime';
import { portal, type AssessmentSpec } from '../../services/api';
import { ASSESSMENT_COPY } from '../copy';

/**
 * bd-5rz1v.13 — what the new Assessment screens share. The endpoints are the ones
 * AssessmentGeneratorPanel and AssessmentPapersPanel use (services/api.ts `portal.*`); nothing
 * here holds an assessment rule — grades, subjects, types and the question cap all come from
 * /assessment/options, as they do for the old panel.
 */

/** As AssessmentGeneratorPanel: ask every 4 s, and stop after 5 minutes (the job's own 300 s). */
export const POLL_INTERVAL_MS = 4000;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Is the generator offered on this deployment (GET /config, features.assessmentGenerator)? */
export function useAssessmentGate(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => portal.getConfig())
      .then((cfg) => { if (live) setOn(cfg?.features?.assessmentGenerator === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

/* ── failures ─────────────────────────────────────────────────────────────── */

export type FailureCode = keyof typeof ASSESSMENT_COPY.failures;
export const FAILURE_CODES = Object.keys(ASSESSMENT_COPY.failures) as FailureCode[];

/** The server's failure code as a short label (never the old panel's sentences). */
export function failureLabel(code?: string | null): string {
  return code && code in ASSESSMENT_COPY.failures
    ? ASSESSMENT_COPY.failures[code as FailureCode]
    : ASSESSMENT_COPY.failureFallback;
}

/* ── words for the server's data ──────────────────────────────────────────── */

/** A question type as a chip: the server's id, shortened when it is long. */
export const typeLabel = (id: string): string => ASSESSMENT_COPY.typeShort[id] ?? id;

const SUBJECT_ICON: Record<string, LucideIcon> = {
  science: FlaskConical,
  maths: Calculator,
  math: Calculator,
  mathematics: Calculator,
  english: CaseSensitive,
  urdu: Languages,
  islamiat: MoonStar,
  general_knowledge: Lightbulb,
  social_studies: Globe,
};

/** Each subject's icon — drawn in neutral grey (DESIGN.md: subject icons are not coloured). */
export function subjectIcon(subjectKey?: string | null): LucideIcon {
  return SUBJECT_ICON[String(subjectKey || '').trim().toLowerCase()] ?? BookOpen;
}

/* ── her picks, kept while she moves around the portal ────────────────────── */

export type ContentSource = 'seen' | 'unseen' | 'both';

export type Picks = {
  grade: number | null;
  subject: string | null;
  subjectName: string | null;
  chapter: number | null;
  chapterTitle: string | null;
  count: number | null;
  types: string[];
  source: ContentSource;
  answerLines: boolean;
};

export const NO_PICKS: Picks = {
  grade: null, subject: null, subjectName: null, chapter: null, chapterTitle: null, count: null,
  types: [], source: 'unseen', answerLines: true,
};

/**
 * "Make another" brings her back to what she just asked for, so a second paper is one change
 * and a tap. In memory only: a reload starts fresh, and nothing is stored on the device.
 */
let remembered: Picks | null = null;
export const recallAssessmentPicks = (): Picks => ({ ...NO_PICKS, ...(remembered || {}) });
export const rememberAssessmentPicks = (p: Picks): void => { remembered = { ...p, types: [...p.types] }; };
/** Tests only. */
export const forgetAssessmentPicks = (): void => { remembered = null; };

/** What the writing page is opened with (its history entry's state). */
export type RequestState = {
  spec: AssessmentSpec;
  subjectName: string | null;
  chapterTitle: string | null;
  /** When she asked (ms), for the time on the ring and the 5-minute limit. */
  startedAt: number;
};

/* ── opening a file ───────────────────────────────────────────────────────── */

/**
 * Open a paper or its answer key — CertificatesPanel's rule (bd-2676, bd-2397):
 *
 *   web      target=_blank: the url is a file, so a new tab keeps her place in the portal.
 *   the app  NO _blank: in the Capacitor WebView a new window is a hand-off to external Chrome.
 *            A plain navigation to the file's (R2) host is not the app's own, so Capacitor gives
 *            it to Android (Bridge.launchIntent: a viewer or the download manager) and cancels
 *            the navigation — the portal stays on this page, with Back where it was.
 *
 * A real anchor rather than window.open or location.assign: the same element the certificate
 * links are, and it never replaces the SPA's page.
 */
export function openFile(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (!isNativeApp()) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

export type DownloadResult = 'opened' | 'unavailable' | 'failed';

/** Ask for a time-limited link (GET /assessment/paper/:id/download) and open it. Never throws. */
export async function downloadArtifact(paperId: string, artifact: 'paper' | 'answer_key'): Promise<DownloadResult> {
  try {
    const res = await portal.getAssessmentDownload(paperId, artifact);
    if (!res?.available || !res.url) return 'unavailable';
    openFile(res.url);
    return 'opened';
  } catch {
    return 'failed';
  }
}
