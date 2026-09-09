/**
 * My papers — everything she has made, browsable (bd-60067, D5).
 *
 * The plan's first draft was a "last 10" strip under the generator. The
 * operator's correction was right and is what this is: a teacher accumulates
 * papers across a term, so this is BROWSING, not a recent-items list. It gets
 * its own tab, pagination, and filters on the same two axes she picked when
 * making the paper — class and subject.
 *
 * It is also what makes a portal paper durable. A portal-generated paper is not
 * sent to WhatsApp (we are usually outside the 24-hour window and would need a
 * template, so it would land sometimes and not others), which means this page
 * is the only way back to it. A one-shot download link would have made the
 * feature a transaction; this makes it a tool.
 *
 * Only `ready` papers appear. Failed attempts are kept in the table on purpose
 * — a retry is a new row precisely so a failure stays visible — but a list of
 * things to download is not where that belongs.
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, KeyRound, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../services/api';
import type { AssessmentPaper, AssessmentSubject } from '../services/api';

const PAGE_SIZE = 10;
const ALL = '__all__';

/** A date a teacher recognises, not an ISO string. */
function madeOn(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type Props = {
  /** Bumped by the generator when a paper finishes, so the list refetches. */
  refreshKey?: number;
};

const AssessmentPapersPanel = ({ refreshKey = 0 }: Props) => {
  const { toast } = useToast();

  const [papers, setPapers] = useState<AssessmentPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [grades, setGrades] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<AssessmentSubject[]>([]);
  const [gradeFilter, setGradeFilter] = useState<string>(ALL);
  const [subjectFilter, setSubjectFilter] = useState<string>(ALL);

  // Grades for the filter. Subjects follow, because "Science" is not a
  // meaningful filter in a Grade 2 list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await portal.getAssessmentOptions(
          gradeFilter === ALL ? undefined : Number(gradeFilter));
        if (cancelled) return;
        setGrades(opts.grades || []);
        setSubjects(opts.subjects || []);
        if (gradeFilter === ALL) setSubjectFilter(ALL);
      } catch {
        /* the filters are a convenience; the list below is the feature */
      }
    })();
    return () => { cancelled = true; };
  }, [gradeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await portal.getAssessmentPapers({
        page,
        page_size: PAGE_SIZE,
        grade: gradeFilter === ALL ? undefined : Number(gradeFilter),
        subject: subjectFilter === ALL ? undefined : subjectFilter,
      });
      setPapers(res.papers || []);
      setTotal(res.total || 0);
    } catch {
      toast({
        title: 'Could not load your papers',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
      // Deliberately NOT cleared to []: an empty list reads as "you have never
      // made a paper", which is a different and more discouraging claim than
      // "we could not reach the server".
    } finally {
      setLoading(false);
    }
  }, [page, gradeFilter, subjectFilter, toast]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // A filter change must not leave her on page 4 of a one-page result.
  useEffect(() => { setPage(1); }, [gradeFilter, subjectFilter]);

  const open = async (paperId: string, artifact: 'paper' | 'answer_key') => {
    try {
      const res = await portal.getAssessmentDownload(paperId, artifact);
      if (!res.available || !res.url) {
        toast({
          title: artifact === 'answer_key' ? 'No answer key for this paper' : 'Not available',
          description: artifact === 'answer_key'
            ? 'This paper was made without one.'
            : 'Please try again in a moment.',
          variant: 'destructive',
        });
        return;
      }
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast({ title: 'Could not open this paper', variant: 'destructive' });
    }
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mp-grade" className="text-xs">Class</Label>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger id="mp-grade" className="w-[10rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All classes</SelectItem>
              {grades.map((g) => (
                <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mp-subject" className="text-xs">Subject</Label>
          <Select
            value={subjectFilter}
            onValueChange={setSubjectFilter}
            disabled={gradeFilter === ALL}
          >
            <SelectTrigger id="mp-subject" className="w-[12rem]">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.subject_key} value={s.subject_key}>{s.subject}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {total > 0 && (
          <p className="ml-auto text-xs text-muted-foreground">
            {total} paper{total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : papers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {gradeFilter === ALL && subjectFilter === ALL
              ? 'No papers yet. Make one from the Assessment Generator tab.'
              : 'No papers match these filters.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {papers.map((p) => (
            <li key={p.paper_id} className="flex flex-wrap items-center gap-3 p-3">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  Grade {p.grade} {p.subject}
                  {p.chapter_number != null ? ` · Chapter ${p.chapter_number}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.question_count != null ? `${p.question_count} questions` : null,
                    p.total_marks != null ? `${p.total_marks} marks` : null,
                    madeOn(p.ready_at),
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => open(p.paper_id, 'paper')}>
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Download
                </Button>
                {/* Drawn only when there is one to hand over. Papers made before
                    we stored the key's location report has_answer_key false, so
                    the button never promises something the API will refuse. */}
                {p.has_answer_key && (
                  <Button size="sm" variant="ghost" onClick={() => open(p.paper_id, 'answer_key')}>
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Key
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page} of {lastPage}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default AssessmentPapersPanel;
