import type { AssessmentPaper } from '../../services/api';
import type { HistoryGroup } from '../ui';
import type { AssessmentV2Copy } from './copy';
import { groupPapersByDay, pkToday } from './model';
import { paperPath } from './paths';

/**
 * bd-fmf24g.34 — her ready papers as the kit's HistoryList groups, by Pakistan day, newest first: ONE mapping for
 * Recent papers on the home and for All papers, so a paper's row reads the same on both. A row says the chapter (or
 * the question count when it was made from pages), then its count, marks and version; `newIds` carry the New dot.
 */
export function paperGroups(papers: AssessmentPaper[], C: AssessmentV2Copy, newIds: readonly string[] = [], today: string = pkToday()): HistoryGroup[] {
  return groupPapersByDay(papers, today, C.days).map((g) => ({
    day: g.day,
    items: g.items.map((p) => ({
      id: p.paper_id,
      subject: p.subject,
      grade: p.grade ?? '',
      title: p.chapter_number != null ? C.chapterShort(p.chapter_number) : C.questionsCount(p.question_count ?? 0),
      extra: C.join(
        p.chapter_number != null && p.question_count != null ? C.questionsCount(p.question_count) : null,
        p.total_marks != null ? C.marksCount(p.total_marks) : null,
        p.version != null && p.version > 1 ? C.version(p.version) : null,
      ),
      isNew: newIds.includes(p.paper_id),
      to: paperPath(p.paper_id),
    })),
  }));
}
