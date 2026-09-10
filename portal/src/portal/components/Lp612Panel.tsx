/**
 * Lesson plans for grades 6-12.
 *
 * WHY THIS IS NOT JUST THE K-5 PICKER WITH DIFFERENT NUMBERS IN IT
 * ----------------------------------------------------------------
 * K-5 lessons are pre-rendered PDFs: pick one, open it. A 6-12 lesson may not have been written
 * yet — about 92% of the 5,466 segments have no render on the current template — and writing one
 * takes a MEDIAN OF 172 SECONDS (p90 314s, measured over every completed render on production).
 *
 * Three things follow, and each is a deliberate difference from the tab next door:
 *
 *  1. EVERY LESSON SAYS WHETHER IT IS READY, in the list, before she picks. Starting a
 *     three-minute job should be something she chooses, not something she discovers.
 *  2. THE WAIT HAS A HOME. "My lesson plans" lists everything she has asked for, so closing the
 *     tab does not lose a lesson — the render finishes regardless and is waiting when she
 *     returns. Without it, a teacher who navigates away loses work we have already paid for.
 *  3. POLLING BACKS OFF. A three-minute job polled every two seconds is ninety requests for one
 *     lesson. The interval widens as the wait lengthens.
 *
 * The panel holds no curriculum rules — no template version, no grade bounds, no view on which
 * subjects are withheld. Every one of those lives in the bot's query, and a test asserts this
 * file cannot reintroduce them.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Download, Loader2, Clock, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type Grade = { grade: number };
type Subject = { subject: string; lesson_count: number };
type Chapter = {
  chapter_key: string;
  chapter_number: number;
  chapter_title: string;
  lesson_count: number;
};
type Lesson = {
  segment_id: string;
  title: string;
  pages_label: string | null;
  ready: boolean;
};
type MyLesson = {
  renderId: string;
  segmentId: string;
  state: 'ready' | 'authoring' | 'failed';
  title: string | null;
  grade: number | null;
  subject: string | null;
  lang: 'en' | 'ur';
  startedAt: string | null;
  errorCode: string | null;
};

/**
 * A three-minute job polled every two seconds is ninety requests for one lesson, and the answer
 * changes once. Start responsive — a cache hit or a fast render should not feel slow — then
 * widen, because after two minutes another second of latency is not what she is noticing.
 */
function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 3_000;
  if (elapsedMs < 120_000) return 6_000;
  return 12_000;
}

const Lp612Panel = () => {
  const { toast } = useToast();

  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [chapterKey, setChapterKey] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [lang, setLang] = useState<'en' | 'ur'>('en');

  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const [working, setWorking] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [mine, setMine] = useState<MyLesson[]>([]);

  // Cleared on unmount so a poll cannot outlive the panel and setState into nothing.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const loadMine = useCallback(async () => {
    try {
      const { data } = await api.get('/lp612/mine');
      setMine(data.lessons || []);
    } catch {
      // Soft: the list is a convenience, and failing to load it must not bury the picker.
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/lp612/grades');
        setGrades(data.grades || []);
      } catch {
        toast({ title: 'Could not load grades', variant: 'destructive' });
      }
    })();
    loadMine();
  }, [toast, loadMine]);

  useEffect(() => {
    setSubjects([]); setChapters([]); setLessons([]);
    setSubject(''); setChapterKey(''); setSegmentId('');
    if (!grade) return;
    (async () => {
      setLoadingSubjects(true);
      try {
        const { data } = await api.get('/lp612/subjects', { params: { grade } });
        setSubjects(data.subjects || []);
      } catch {
        toast({ title: 'Could not load subjects', variant: 'destructive' });
      } finally { setLoadingSubjects(false); }
    })();
  }, [grade, toast]);

  useEffect(() => {
    setChapters([]); setLessons([]);
    setChapterKey(''); setSegmentId('');
    if (!grade || !subject) return;
    (async () => {
      setLoadingChapters(true);
      try {
        const { data } = await api.get('/lp612/chapters', { params: { grade, subject } });
        setChapters(data.chapters || []);
      } catch {
        toast({ title: 'Could not load chapters', variant: 'destructive' });
      } finally { setLoadingChapters(false); }
    })();
  }, [grade, subject, toast]);

  useEffect(() => {
    setLessons([]); setSegmentId('');
    if (!grade || !subject || !chapterKey) return;
    (async () => {
      setLoadingLessons(true);
      try {
        const { data } = await api.get('/lp612/lessons', {
          params: { grade, subject, chapter_key: chapterKey, lang },
        });
        setLessons(data.lessons || []);
      } catch {
        toast({ title: 'Could not load lessons', variant: 'destructive' });
      } finally { setLoadingLessons(false); }
    })();
  }, [grade, subject, chapterKey, lang, toast]);

  const chosen = lessons.find((l) => l.segment_id === segmentId);

  /** Open a finished lesson. The URL is minted per click — a presigned link expires. */
  const open = useCallback(async (renderId: string) => {
    try {
      const { data } = await api.get(`/lp612/status/${renderId}`);
      if (data.state === 'ready' && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
      toast({ title: 'That lesson is not ready yet' });
    } catch {
      toast({ title: 'Could not open that lesson', variant: 'destructive' });
    }
  }, [toast]);

  /** Poll one render to completion, backing off as the wait lengthens. */
  const poll = useCallback((renderId: string, startedAt: number) => {
    const tick = async () => {
      try {
        const { data } = await api.get(`/lp612/status/${renderId}`);

        if (data.state === 'ready') {
          setWorking(false); setWaitingSince(null);
          loadMine();
          toast({ title: 'Your lesson plan is ready' });
          if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
          return;
        }
        if (data.state === 'failed') {
          setWorking(false); setWaitingSince(null);
          loadMine();
          toast({
            title: 'That lesson could not be written',
            description: 'Try again — it usually works on a second attempt.',
            variant: 'destructive',
          });
          return;
        }
      } catch {
        // A dropped poll is not a failed render. The job is running on a worker regardless of
        // whether this browser can reach us, so keep asking rather than declaring it lost —
        // and "My lesson plans" is the backstop if she leaves before it lands.
      }
      timer.current = setTimeout(tick, pollDelay(Date.now() - startedAt));
    };
    timer.current = setTimeout(tick, pollDelay(0));
  }, [toast, loadMine]);

  const request = useCallback(async () => {
    if (!segmentId) return;
    setWorking(true);
    try {
      const { data } = await api.post('/lp612/request', { segment_id: segmentId, lang });
      const startedAt = Date.now();

      if (data.state === 'ready') {
        // Already written. Fetch the link and hand it over — no wait, no polling.
        setWorking(false);
        await open(data.renderId);
        loadMine();
        return;
      }

      setWaitingSince(startedAt);
      loadMine();
      poll(data.renderId, startedAt);
    } catch (err: unknown) {
      setWorking(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast({
        title: status === 403
          ? 'That lesson is not available yet'
          : status === 404
            ? 'That lesson is not in the catalogue'
            : 'Could not start that lesson',
        variant: 'destructive',
      });
    }
  }, [segmentId, lang, open, poll, loadMine, toast]);

  const waitedSec = waitingSince ? Math.floor((Date.now() - waitingSince) / 1000) : 0;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold mb-2 text-foreground">1. Grade</label>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger><SelectValue placeholder="Select grade..." /></SelectTrigger>
            <SelectContent>
              {grades.map((g) => (
                <SelectItem key={g.grade} value={String(g.grade)}>Grade {g.grade}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2 text-foreground">2. Subject</label>
          <Select value={subject} onValueChange={setSubject} disabled={!grade || loadingSubjects}>
            <SelectTrigger>
              <SelectValue placeholder={
                !grade ? 'Select grade first'
                  : loadingSubjects ? 'Loading...'
                    : subjects.length === 0 ? 'No subjects' : 'Select subject...'
              } />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.subject} value={s.subject}>
                  {s.subject}
                  <span className="text-muted-foreground text-xs ml-2">
                    ({s.lesson_count} lessons)
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2 text-foreground">3. Chapter</label>
          <Select value={chapterKey} onValueChange={setChapterKey} disabled={!subject || loadingChapters}>
            <SelectTrigger>
              <SelectValue placeholder={
                !subject ? 'Select subject first'
                  : loadingChapters ? 'Loading...'
                    : chapters.length === 0 ? 'No chapters' : 'Select chapter...'
              } />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c.chapter_key} value={c.chapter_key}>
                  <span className="font-medium">Ch {c.chapter_number}: {c.chapter_title}</span>
                  <span className="text-muted-foreground text-xs ml-2">
                    · {c.lesson_count} lessons
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2 text-foreground">4. Lesson</label>
          <Select value={segmentId} onValueChange={setSegmentId} disabled={!chapterKey || loadingLessons}>
            <SelectTrigger>
              <SelectValue placeholder={
                !chapterKey ? 'Select chapter first'
                  : loadingLessons ? 'Loading...'
                    : lessons.length === 0 ? 'No lessons' : 'Select lesson...'
              } />
            </SelectTrigger>
            <SelectContent>
              {lessons.map((l) => (
                <SelectItem key={l.segment_id} value={l.segment_id}>
                  {/* READY IS SHOWN IN THE LIST, not discovered after the tap. */}
                  <span className="font-medium">{l.title}</span>
                  <span className="text-muted-foreground text-xs ml-2">
                    {l.pages_label ? `· ${l.pages_label} ` : ''}
                    {l.ready ? '· ready now' : '· takes ~3 min'}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={lang} onValueChange={(v) => setLang(v as 'en' | 'ur')}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ur">اردو</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={request} disabled={!segmentId || working}>
          {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : chosen?.ready ? <Download className="h-4 w-4 mr-2" />
              : <Sparkles className="h-4 w-4 mr-2" />}
          {chosen?.ready ? 'Open lesson plan' : 'Write this lesson plan'}
        </Button>

        {/* The honest warning, on the button's own row, before she commits. */}
        {chosen && !chosen.ready && !working && (
          <span className="text-sm text-muted-foreground">
            Not written yet — this takes about 3 minutes.
          </span>
        )}
      </div>

      {waitingSince && (
        <div className="rounded-lg border bg-muted/40 p-4 mb-6">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" />
            Writing your lesson plan…
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            About three minutes. {waitedSec > 0 && `${waitedSec}s so far. `}
            You can leave this page — it will be waiting in <strong>My lesson plans</strong> below.
          </p>
        </div>
      )}

      {/* ── My lesson plans ─────────────────────────────────────────────────
          THE REASON THIS EXISTS: at a median of ~3 minutes she will navigate
          away, and the render finishes regardless. Without somewhere for it to
          land, a lesson we already paid for is simply lost to her. */}
      <div className="border-t pt-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <BookOpen className="h-4 w-4" /> My lesson plans
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Every grade 6-12 lesson you have asked for.
        </p>

        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet — pick a lesson above to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {mine.map((m) => (
              <li
                key={m.renderId}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.title || m.segmentId}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.grade ? `Grade ${m.grade}` : ''}
                    {m.subject ? ` · ${m.subject}` : ''}
                    {m.lang === 'ur' ? ' · اردو' : ''}
                  </div>
                </div>

                {m.state === 'ready' && (
                  <Button size="sm" variant="outline" onClick={() => open(m.renderId)}>
                    <Download className="h-4 w-4 mr-1" /> Open
                  </Button>
                )}
                {m.state === 'authoring' && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1 shrink-0">
                    <Clock className="h-4 w-4" /> Writing…
                  </span>
                )}
                {m.state === 'failed' && (
                  <span className="text-sm text-destructive flex items-center gap-1 shrink-0">
                    <AlertCircle className="h-4 w-4" /> Failed
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Lp612Panel;
