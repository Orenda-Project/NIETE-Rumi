/**
 * AssessmentGeneratorPanel — asking the bot for an exam paper.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A form that had no engine behind it. POST /assessment/generate answered 404
 * on production while the config flag kept the tab lit, because the routes were
 * razed with the old UG_EG generator and the September rebuild went
 * WhatsApp-Flow-only.
 *
 * The old panel had also drifted from the bot in three ways worth naming, since
 * avoiding all three is why this one looks the way it does:
 *   - MAX_COUNT = 20 against the bot's MAX_QUESTIONS = 25
 *   - its own hardcoded SUBJECTS_LOWER / SUBJECTS_UPPER arrays
 *   - UG_EG subject ids ('Eng', 'GenK') the current generator does not resolve
 *
 * SO: THIS COMPONENT KNOWS NO ASSESSMENT RULES
 * --------------------------------------------
 * Every option — which grades, which subjects, which question types, and the
 * question cap — arrives from /assessment/options. The form physically cannot
 * offer something the validator will refuse, because it does not hold the
 * numbers or the lists that would let it disagree.
 *
 * CHAPTER FIRST, PAGES BEHIND "MORE OPTIONS"
 * -------------------------------------------
 * Teachers think in chapters, and the bot already resolves a chapter to its
 * pages before storing the request. Page ranges stay available for the teacher
 * who wants them, one disclosure down.
 *
 * WHY IT NO LONGER POLLS (bd-t5tow)
 * ---------------------------------
 * Generation is a queued job of about a minute, polled until it lands. That
 * now happens at page level (assessment-jobs/usePaperJobs), because the page
 * has two tabs — Create paper and My papers — and a paper being made shows in
 * both; switching tabs must not stop the tracking. This panel starts a job via
 * `onStart` and draws the card for the one job it started (`currentJob`).
 *
 * THE CARD STAYS UNTIL SHE MOVES ON
 * ---------------------------------
 * The writing / ready card replaces the form until she presses Make another or
 * opens My papers (the page then stops passing `currentJob`). Never on a timer:
 * a card that vanishes while she is reading it is a paper she cannot find.
 *
 * NO WHATSAPP COPY
 * ----------------
 * A portal-generated paper stays on the portal. We are usually outside the
 * 24-hour window and would need a template, so a "we also sent it to WhatsApp"
 * promise would hold sometimes and not others. My papers is what makes it
 * durable instead.
 */

import { useState, useEffect } from 'react';
import { FileText, Loader2, Download, Sparkles, ChevronDown, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SkeletonList, SkeletonChip } from './Skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../services/api';
import type {
  AssessmentChapter, AssessmentQuestionType, AssessmentSpec, AssessmentSubject,
} from '../services/api';
import { FAILURE_FALLBACK } from './assessment-jobs/failureMessages';
import type { PaperJob, StartResult } from './assessment-jobs/usePaperJobs';

type Props = {
  /** The job this tab started, while its card is showing; null shows the form. */
  currentJob?: PaperJob | null;
  /** Starts a job at page level (usePaperJobs.start). */
  onStart: (spec: AssessmentSpec, label: string) => Promise<StartResult>;
  /** Go to My papers / See in My papers. */
  onGoToPapers: () => void;
  /** Make another: back to the form; a job still writing carries on in My papers. */
  onMakeAnother: () => void;
};

const AssessmentGeneratorPanel = ({
  currentJob = null, onStart, onGoToPapers, onMakeAnother,
}: Props) => {
  const { toast } = useToast();

  // ── options, all server-supplied ────────────────────────────────────────
  const [grades, setGrades] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<AssessmentSubject[]>([]);
  const [types, setTypes] = useState<AssessmentQuestionType[]>([]);
  const [chapters, setChapters] = useState<AssessmentChapter[]>([]);
  const [maxQuestions, setMaxQuestions] = useState<number | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);

  // ── her choices ─────────────────────────────────────────────────────────
  const [grade, setGrade] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  // Any number of chapters, in book order (bd-ix9uhr): one paper can cover several.
  const [chapterNumbers, setChapterNumbers] = useState<number[]>([]);
  const [questionCount, setQuestionCount] = useState<string>('');
  const [pickedTypes, setPickedTypes] = useState<string[]>([]);
  const [contentSource, setContentSource] = useState<'seen' | 'unseen' | 'both'>('unseen');
  const [answerLines, setAnswerLines] = useState(true);
  const [showMore, setShowMore] = useState(false);

  // ── where we are ────────────────────────────────────────────────────────
  // A failed job shows the form again; the page has already said why.
  const phase = currentJob?.status === 'writing' ? 'working'
    : currentJob?.status === 'ready' ? 'ready' : 'form';
  const paperId = currentJob?.status === 'ready' ? currentJob.paperId ?? null : null;
  const [submitting, setSubmitting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  // ── the grade list, once ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await portal.getAssessmentOptions();
        if (cancelled) return;
        setGrades(opts.grades || []);
        setMaxQuestions(opts.maxQuestions);
        // The default count comes from the bot too, so the field starts on a
        // value the validator already accepts.
        setQuestionCount(String(opts.defaultQuestions));
      } catch {
        if (!cancelled) {
          toast({
            title: 'Could not load the assessment options',
            description: 'Please refresh the page.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  // ── subjects follow the grade ───────────────────────────────────────────
  useEffect(() => {
    if (!grade) { setSubjects([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const opts = await portal.getAssessmentOptions(Number(grade));
        if (cancelled) return;
        setSubjects(opts.subjects || []);
        // A subject that is not taught in the new grade must not survive the
        // change — Science does not exist below Grade 4.
        setSubject((cur) => ((opts.subjects || []).some((s) => s.subject_key === cur) ? cur : ''));
      } catch {
        if (!cancelled) setSubjects([]);
      }
    })();
    return () => { cancelled = true; };
  }, [grade]);

  // ── chapters and question types follow the subject ──────────────────────
  useEffect(() => {
    if (!grade || !subject) { setChapters([]); setTypes([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [chapterRes, opts] = await Promise.all([
          portal.getAssessmentChapters(Number(grade), subject),
          portal.getAssessmentOptions(Number(grade), subject),
        ]);
        if (cancelled) return;
        setChapters(chapterRes.chapters || []);
        setTypes(opts.types || []);
        setMaxQuestions(opts.maxQuestions);
        setChapterNumbers([]);
        setPickedTypes([]);
      } catch {
        if (!cancelled) { setChapters([]); setTypes([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [grade, subject]);

  const chosen = chapters.filter((c) => chapterNumbers.includes(c.chapter_number));
  const toggleChapter = (n: number) => setChapterNumbers((cur) =>
    (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)));

  /**
   * Validate the count against the SERVER's cap.
   *
   * Refused rather than clamped, matching the bot exactly: quietly turning 40
   * into 25 hands her a paper she did not ask for and never mentions it.
   */
  const validateCount = (raw: string): string | null => {
    const text = raw.trim();
    if (!maxQuestions) return null;
    const range = `Type a number between 1 and ${maxQuestions}.`;
    if (!/^\d+$/.test(text)) return range;
    const n = Number(text);
    if (n < 1) return range;
    if (n > maxQuestions) return `A paper can hold up to ${maxQuestions} questions. ${range}`;
    return null;
  };

  const canSubmit = !!grade && !!subject && chapterNumbers.length > 0
    && !validateCount(questionCount) && !submitting;

  const toggleType = (id: string) => setPickedTypes((cur) =>
    (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const submit = async () => {
    const err = validateCount(questionCount);
    if (err) { setCountError(err); return; }

    setSubmitting(true);
    try {
      const spec: AssessmentSpec = {
        grade: Number(grade),
        subject,
        // A lone chapter also goes by itself, so a bot that predates chapterNumbers still reads it.
        chapterNumber: chapterNumbers.length === 1 ? chapterNumbers[0] : null,
        chapterNumbers,
        contentSource,
        questionCount: Number(questionCount),
        questionTypes: pickedTypes,
        // No answer-key choice: every paper is made with its key.
        answerLines,
        outputFormat: 'pdf',
      };
      const label = [
        `Grade ${grade} ${subjects.find((s) => s.subject_key === subject)?.subject ?? subject}`,
        chosen.length === 1 ? chosen[0].chapter_title : `Chapters ${chapterNumbers.join(', ')}`,
        `${Number(questionCount)} questions`,
      ].filter(Boolean).join(' · ');

      // The page sends it and keeps checking on it (usePaperJobs); a refusal
      // comes back here with the same sentence this panel always showed.
      const res = await onStart(spec, label);
      if (res.ok === false) {
        toast({
          title: 'Could not start your paper',
          description: res.error || FAILURE_FALLBACK,
          variant: 'destructive',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openArtifact = async (artifact: 'paper' | 'answer_key') => {
    if (!paperId) return;
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

  if (loadingOptions) {
    return (
      // bd-fxk3t8 — placeholders where the options will be, not a spinner.
      <div role="status" aria-busy="true" aria-label="Loading…" className="space-y-4 py-4">
        <div className="flex flex-wrap gap-2"><SkeletonChip /><SkeletonChip /><SkeletonChip /></div>
        <SkeletonList rows={2} />
      </div>
    );
  }

  if (phase === 'working' && currentJob) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <h3 className="text-lg font-medium">Writing your paper</h3>
        <p className="text-sm text-muted-foreground">{currentJob.label}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This takes about a minute. You can switch to My papers or leave this page; your paper keeps being made and will be waiting in My papers.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={onGoToPapers}>Go to My papers</Button>
          <Button variant="ghost" onClick={onMakeAnother}>Make another</Button>
        </div>
      </div>
    );
  }

  if (phase === 'ready' && currentJob) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border py-14 text-center">
        <FileText className="h-9 w-9 text-primary" aria-hidden="true" />
        <div>
          <h3 className="text-lg font-medium">Your paper is ready</h3>
          <p className="text-sm text-muted-foreground">{currentJob.label}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => openArtifact('paper')}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download
          </Button>
          <Button variant="outline" onClick={() => openArtifact('answer_key')}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            Answer key
          </Button>
          <Button variant="outline" onClick={onGoToPapers}>See in My papers</Button>
          <Button variant="ghost" onClick={onMakeAnother}>Make another</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          It stays in My papers, so you can download it again later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ag-grade">Class</Label>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger id="ag-grade"><SelectValue placeholder="Pick a class" /></SelectTrigger>
            <SelectContent>
              {grades.map((g) => (
                <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ag-subject">Subject</Label>
          <Select value={subject} onValueChange={setSubject} disabled={!grade}>
            <SelectTrigger id="ag-subject">
              <SelectValue placeholder={grade ? 'Pick a subject' : 'Pick a class first'} />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.subject_key} value={s.subject_key}>{s.subject}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-1.5" disabled={!subject}>
        <legend className="text-sm font-medium leading-none">Chapters</legend>
        {!subject ? (
          <p className="text-sm text-muted-foreground">Pick a subject first</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {chapters.map((c) => (
              <label
                key={c.chapter_number}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={chapterNumbers.includes(c.chapter_number)}
                  onCheckedChange={() => toggleChapter(c.chapter_number)}
                />
                <span className="flex-1">{c.chapter_number} · {c.chapter_title}</span>
                {c.page_start != null && (
                  <span className="text-xs text-muted-foreground">p.{c.page_start}–{c.page_end}</span>
                )}
              </label>
            ))}
          </div>
        )}
        {chosen.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {chosen.length === 1 ? '1 chapter' : `${chosen.length} chapters`}
            {chosen.every((c) => c.page_count) ? ` · ${chosen.reduce((n, c) => n + (c.page_count || 0), 0)} pages` : ''}
          </p>
        )}
      </fieldset>

      <div className="space-y-1.5 sm:max-w-[12rem]">
        <Label htmlFor="ag-count">Questions</Label>
        <Input
          id="ag-count"
          inputMode="numeric"
          value={questionCount}
          onChange={(e) => { setQuestionCount(e.target.value); setCountError(null); }}
          onBlur={() => setCountError(validateCount(questionCount))}
          aria-invalid={!!countError}
          aria-describedby="ag-count-help"
        />
        <p
          id="ag-count-help"
          className={`text-xs ${countError ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {countError || (maxQuestions ? `Up to ${maxQuestions}.` : '')}
        </p>
      </div>

      <div className="rounded-lg border">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          More options
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {showMore && (
          <div className="space-y-4 border-t px-4 py-4">
            <div className="space-y-2">
              <Label>Question types</Label>
              <div className="flex flex-wrap gap-2">
                {types.map((t) => {
                  const on = pickedTypes.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleType(t.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {t.id}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave these alone and we will pick a good mix for you.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ag-source">Questions come from</Label>
              <Select
                value={contentSource}
                onValueChange={(v) => setContentSource(v as 'seen' | 'unseen' | 'both')}
              >
                <SelectTrigger id="ag-source" className="sm:max-w-[16rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seen">The book</SelectItem>
                  <SelectItem value="unseen">New, on the same topics</SelectItem>
                  <SelectItem value="both">A mix</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={answerLines}
                  onChange={(e) => setAnswerLines(e.target.checked)}
                  className="h-4 w-4"
                />
                Answer lines
              </label>
            </div>
          </div>
        )}
      </div>

      <Button onClick={submit} disabled={!canSubmit} className="w-full sm:w-auto">
        {submitting
          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
        Generate
      </Button>
    </div>
  );
};

export default AssessmentGeneratorPanel;
