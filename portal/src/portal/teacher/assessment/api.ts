import { useEffect, useState } from 'react';
import { portal, type AssessmentChapter, type AssessmentPaperList, type AssessmentQuestionType } from '../../services/api';
import { readConfigShared } from '../../lib/useNewUi';

/**
 * bd-fmf24g.6 — what the teacher v2 Assessment reads. Every route is today's (`portal.*` in
 * services/api.ts, the ones AssessmentGeneratorPanel / AssessmentPapersPanel / the new UI use); nothing
 * here holds a list or a cap the bot owns — grades, subjects, types and the question cap all come from
 * GET /assessment/options, chapters from GET /assessment/chapters.
 */

export type CatalogueSubject = { key: string; name: string };
export type Catalogue = {
  grades: number[];
  /** Each grade's subjects (key + the API's name), as /assessment/options?grade= lists them. */
  byGrade: Record<number, CatalogueSubject[]>;
  maxQuestions: number;
  defaultQuestions: number;
};

/** The grades on offer, then each grade's subjects (a handful of small reads, in parallel). */
export async function loadCatalogue(): Promise<Catalogue> {
  const top = await portal.getAssessmentOptions();
  const grades = (top.grades || []).filter((g) => Number.isInteger(g));
  const per = await Promise.all(grades.map(async (g) => {
    const o = await portal.getAssessmentOptions(g);
    return [g, (o.subjects || []).map((s) => ({ key: s.subject_key, name: s.subject }))] as const;
  }));
  return {
    grades,
    byGrade: Object.fromEntries(per),
    maxQuestions: top.maxQuestions,
    defaultQuestions: top.defaultQuestions,
  };
}

let catalogueInflight: Promise<Catalogue> | null = null;

/** loadCatalogue, once per page load (a failed read is asked again next time). */
export function catalogueOnce(): Promise<Catalogue> {
  if (!catalogueInflight) {
    catalogueInflight = loadCatalogue();
    catalogueInflight.catch(() => { catalogueInflight = null; });
  }
  return catalogueInflight;
}

/** Tests only. */
export function forgetCatalogue(): void { catalogueInflight = null; }

/** The subject's name the catalogue gives, else its key. */
export function subjectName(cat: Catalogue | undefined, grade: number | null, key: string | null): string {
  if (!key) return '';
  const hit = grade !== null ? cat?.byGrade[grade]?.find((s) => s.key === key) : undefined;
  return hit?.name ?? key;
}

export async function loadChapters(grade: number, subject: string): Promise<AssessmentChapter[]> {
  const res = await portal.getAssessmentChapters(grade, subject);
  return res.chapters || [];
}

export async function loadTypes(grade: number, subject: string): Promise<AssessmentQuestionType[]> {
  const res = await portal.getAssessmentOptions(grade, subject);
  return res.types || [];
}

export function loadPapers(params: { page: number; grade?: number; subject?: string }): Promise<AssessmentPaperList> {
  return portal.getAssessmentPapers({ ...params, page_size: 10 });
}

/** GET /config's two assessment switches: the generator at all, and editing a paper. null while reading. */
export function useAssessmentSwitches(): { generator: boolean; editing: boolean } | null {
  const [on, setOn] = useState<{ generator: boolean; editing: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => {
        if (live) {
          setOn({
            generator: cfg?.features?.assessmentGenerator === true,
            editing: cfg?.features?.assessmentEditing === true,
          });
        }
      })
      .catch(() => { if (live) setOn({ generator: false, editing: false }); });
    return () => { live = false; };
  }, []);
  return on;
}
