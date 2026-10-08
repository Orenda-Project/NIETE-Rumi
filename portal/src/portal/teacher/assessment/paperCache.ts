import { portal, type AssessmentPaper } from '../../services/api';

/**
 * bd-fmf24g.6 — the papers My papers has already read, so the paper page opens at once from a row. A
 * reload (or a link) reads her list until it finds the paper (GET /assessment/papers has no single-paper
 * read); a paper not in her list is not found — the server only ever lists her own.
 */
const seen = new Map<string, AssessmentPaper>();

export function rememberPapers(papers: AssessmentPaper[]): void {
  papers.forEach((p) => seen.set(p.paper_id, p));
}

export async function findPaper(paperId: string, maxPages = 5): Promise<AssessmentPaper | null> {
  const hit = seen.get(paperId);
  if (hit) return hit;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await portal.getAssessmentPapers({ page, page_size: 20 });
    rememberPapers(res.papers || []);
    const found = (res.papers || []).find((p) => p.paper_id === paperId);
    if (found) return found;
    if (!res.papers?.length || page * 20 >= (res.total || 0)) break;
  }
  return null;
}

/** Tests only. */
export function forgetPapers(): void { seen.clear(); }
