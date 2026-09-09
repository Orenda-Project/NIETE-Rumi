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
 * WHY IT POLLS
 * ------------
 * Generation is a queued job of about a minute (the model call alone is ~25s).
 * `queued` and `generating` are ordinary answers, not errors — only `failed`
 * draws an apology, and it names the real reason rather than shrugging.
 *
 * NO WHATSAPP COPY
 * ----------------
 * A portal-generated paper stays on the portal. We are usually outside the
 * 24-hour window and would need a template, so a "we also sent it to WhatsApp"
 * promise would hold sometimes and not others. My papers is what makes it
 * durable instead.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { FileText, Loader2, Download, Sparkles, ChevronDown, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../services/api';
import type {
  AssessmentChapter, AssessmentQuestionType, AssessmentSubject,
} from '../services/api';

const POLL_INTERVAL_MS = 4000;

/**
 * How long to keep asking before saying something is wrong.
 *
 * The job extends its own SQS visibility to 300s, so a paper that has not
 * arrived by then is not merely slow. Without a ceiling the spinner is
 * indistinguishable from a worker that died, and she waits forever on a
 * promise nothing is going to keep.
 */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * What she is told, per failure code, in words that name the thing she can
 * change. The bot has its own copy of these for WhatsApp; this is the same set
 * of situations phrased for a page rather than a chat.
 */
const FAILURE_MESSAGE: Record<string, string> = {
  BOOK_NOT_FOUND: "We don't have that book yet. Try a different class or subject.",
  CHAPTER_NOT_FOUND: "We couldn't find that chapter. Please pick another one.",
  NO_CONTENT: "We don't have the text for that chapter yet — please try another chapter.",
  PAGE_OUT_OF_RANGE: 'Those page numbers are outside this book. Please check and try again.',
  INVALID_PAGE_RANGE: "Those page numbers didn't make sense. Try something like 4-14.",
  TRUNCATED: 'That was a lot to write in one go. Please try again with fewer questions.',
  MODEL_UNAVAILABLE: "Sorry — we couldn't build your paper just now. Please try again in a moment.",
  BAD_JSON: "Sorry — that didn't come out right. Please try again.",
  NO_QUESTIONS: "Sorry — we couldn't write questions from that chapter. Please try another.",
  RENDER_FAILED: "Sorry — we couldn't make the file. Please try again.",
  UPLOAD_FAILED: "Sorry — we couldn't save your paper. Please try again.",
};
const FAILURE_FALLBACK = 'Sorry — something went wrong making your paper. Please try again.';

type Phase = 'form' | 'working' | 'ready';

type Props = {
  /** Called when a paper finishes, so My papers can refresh. */
  onPaperReady?: () => void;
};

const AssessmentGeneratorPanel = ({ onPaperReady }: Props) => {
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
  const [chapterNumber, setChapterNumber] = useState<string>('');
  const [questionCount, setQuestionCount] = useState<string>('');
  const [pickedTypes, setPickedTypes] = useState<string[]>([]);
  const [contentSource, setContentSource] = useState<'seen' | 'unseen' | 'both'>('unseen');
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);
  const [answerLines, setAnswerLines] = useState(true);
  const [showMore, setShowMore] = useState(false);

  // ── where we are ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('form');
  const [submitting, setSubmitting] = useState(false);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

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
        setChapterNumber('');
        setPickedTypes([]);
      } catch {
        if (!cancelled) { setChapters([]); setTypes([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [grade, subject]);

  const chosenChapter = chapters.find((c) => String(c.chapter_number) === chapterNumber);

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

  const canSubmit = !!grade && !!subject && !!chapterNumber
    && !validateCount(questionCount) && !submitting;

  const toggleType = (id: string) => setPickedTypes((cur) =>
    (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const reset = () => {
    stopPolling();
    setPhase('form');
    setPaperId(null);
  };

  const finishWithFailure = useCallback((code?: string | null) => {
    stopPolling();
    setPhase('form');
    toast({
      title: 'We could not make your paper',
      description: (code && FAILURE_MESSAGE[code]) || FAILURE_FALLBACK,
      variant: 'destructive',
    });
  }, [stopPolling, toast]);

  const poll = useCallback(async (requestId: string) => {
    try {
      const res = await portal.getAssessmentStatus(requestId);

      if (res.status === 'ready' && res.paperId) {
        stopPolling();
        setPaperId(res.paperId);
        setPhase('ready');
        onPaperReady?.();
        return;
      }
      if (res.status === 'failed') { finishWithFailure(res.errorCode); return; }
      if (res.status === 'not_found') { finishWithFailure(null); return; }

      // queued | generating — keep waiting, but not forever.
      if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
        stopPolling();
        setPhase('form');
        toast({
          title: 'This is taking longer than it should',
          description: 'Your paper may still arrive — check My papers in a few minutes.',
          variant: 'destructive',
        });
      }
    } catch {
      // A transport blip must not kill the wait: the job is running on the
      // server regardless of whether this one request got through.
    }
  }, [finishWithFailure, onPaperReady, stopPolling, toast]);

  const submit = async () => {
    const err = validateCount(questionCount);
    if (err) { setCountError(err); return; }

    setSubmitting(true);
    try {
      const res = await portal.generateAssessment({
        grade: Number(grade),
        subject,
        chapterNumber: Number(chapterNumber),
        contentSource,
        questionCount: Number(questionCount),
        questionTypes: pickedTypes,
        includeAnswerKey,
        answerLines,
        outputFormat: 'pdf',
      });

      if (!res.success || !res.requestId) {
        toast({
          title: 'Could not start your paper',
          description: res.error || FAILURE_FALLBACK,
          variant: 'destructive',
        });
        return;
      }

      setPhase('working');
      startedAtRef.current = Date.now();
      stopPolling();
      pollRef.current = setInterval(() => poll(res.requestId as string), POLL_INTERVAL_MS);
      poll(res.requestId);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast({
        title: 'Could not start your paper',
        description: message || FAILURE_FALLBACK,
        variant: 'destructive',
      });
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
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (phase === 'working') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <h3 className="text-lg font-medium">Writing your paper</h3>
        <p className="text-sm text-muted-foreground">
          Grade {grade} · {subjects.find((s) => s.subject_key === subject)?.subject}
          {chosenChapter ? ` · ${chosenChapter.chapter_title}` : ''}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This takes about a minute. You can leave this page — it will be in My papers
          when it is done.
        </p>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border py-14 text-center">
        <FileText className="h-9 w-9 text-primary" aria-hidden="true" />
        <div>
          <h3 className="text-lg font-medium">Your paper is ready</h3>
          <p className="text-sm text-muted-foreground">
            Grade {grade} · {subjects.find((s) => s.subject_key === subject)?.subject}
            {chosenChapter ? ` · ${chosenChapter.chapter_title}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => openArtifact('paper')}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download
          </Button>
          {includeAnswerKey && (
            <Button variant="outline" onClick={() => openArtifact('answer_key')}>
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
              Answer key
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>Make another</Button>
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

      <div className="space-y-1.5">
        <Label htmlFor="ag-chapter">Chapter</Label>
        <Select value={chapterNumber} onValueChange={setChapterNumber} disabled={!subject}>
          <SelectTrigger id="ag-chapter">
            <SelectValue placeholder={subject ? 'Pick a chapter' : 'Pick a subject first'} />
          </SelectTrigger>
          <SelectContent>
            {chapters.map((c) => (
              <SelectItem key={c.chapter_number} value={String(c.chapter_number)}>
                {c.chapter_number} · {c.chapter_title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosenChapter && chosenChapter.page_start != null && (
          <p className="text-xs text-muted-foreground">
            Pages {chosenChapter.page_start}–{chosenChapter.page_end}
            {chosenChapter.page_count ? ` · ${chosenChapter.page_count} pages` : ''}
          </p>
        )}
      </div>

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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeAnswerKey}
                  onChange={(e) => setIncludeAnswerKey(e.target.checked)}
                  className="h-4 w-4"
                />
                Answer key
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
