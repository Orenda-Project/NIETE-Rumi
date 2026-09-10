/**
 * PortalCurriculum — the same lesson-plan catalogue the WhatsApp bot serves.
 *
 *   Grade ▼   Subject ▼   Chapter ▼   Lesson ▼    [ Open PDF → ]
 *
 * Every dropdown is populated by the BOT, over the portal's catalogue client.
 * The portal holds no LP query logic: it used to read its own tables and so
 * offered a different corpus from WhatsApp — grade 5 maths showed no chapters
 * here while the bot had eight.
 *
 * A lesson is offered iff its PDF has been rendered and uploaded. There is no
 * "prepare this one" button: these assets are pre-rendered, so availability is
 * the only gate and there is nothing for a teacher to queue.
 *
 * `downloaded` mirrors the ✓ tick the WhatsApp picker shows — the same
 * per-teacher record, so the two surfaces agree about what she already has.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import api, { portal } from '../services/api';
import AssessmentGeneratorPanel from '../components/AssessmentGeneratorPanel';
import AssessmentGeneratorComingSoon from '../components/AssessmentGeneratorComingSoon';
import AssessmentPapersPanel from '../components/AssessmentPapersPanel';
import MyLesson612Panel from '../components/MyLesson612Panel';

/**
 * ONE GRADE LIST, TWO CORPORA BEHIND IT.
 *
 * Grades 1-5 are pre-rendered PDFs in the v8 catalogue; grades 6-12 are segments in the lp612
 * corpus that may still have to be WRITTEN, which takes about three minutes. A teacher does not
 * think of those as two products, so the picker does not present them as two — she picks a grade
 * and the page asks the right service. `lane` is what carries that, resolved once when the grade
 * list is built rather than re-derived from a number at each call site.
 */
type Lane = 'k5' | 'g612';
type Grade = { grade: number; subject_count?: number; lane: Lane };
/**
 * NORMALISED ACROSS BOTH LANES, on the way in.
 *
 * The two services answer with different keys — K-5 identifies a subject by `subject_key`
 * ('math') and a chapter by its NUMBER; 6-12 identifies a subject by its display name
 * ('Mathematics') and a chapter by `chapter_key`, because one grade+subject can span two books
 * and both can have a chapter 1. Neither is wrong for its own corpus.
 *
 * Rather than teach the picker both dialects — four `lane === ...` branches in the JSX, each a
 * place to get it wrong — each loader maps its answer into the shape below. `key` is whatever
 * that lane needs passed back to it, opaque to the UI.
 */
type Subject = { key: string; label: string; lesson_count: number };
type Chapter = {
  key: string;
  chapter_number: number;
  chapter_title: string;
  pages_label: string | null;
  lesson_count: number;
};
type LessonPlan = {
  /** K-5: the catalogue lesson_id. 6-12: the segment_id. Opaque to the picker. */
  id: string;
  title: string;
  pages_label: string | null;
  /** K-5 only — the ✓/○ tick, from niete_lp_downloads. */
  downloaded?: boolean;
  /** 6-12 only — false means tapping this WRITES it, and that takes ~3 minutes. */
  ready?: boolean;
  subtitle: string | null;
};

const PortalCurriculum = () => {
  const { toast } = useToast();

  // bd-2460 — null while loading, so the tab never flashes a form that is off.
  const [assessmentEnabled, setAssessmentEnabled] = useState<boolean | null>(null);
  const [assessmentMessage, setAssessmentMessage] = useState<string | null>(null);
  // Bumped when a paper finishes so My papers refetches — she should not have
  // to reload the page to see the thing she just made.
  const [papersRefreshKey, setPapersRefreshKey] = useState(0);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lps, setLps] = useState<LessonPlan[]>([]);

  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedChapter, setSelectedChapter] = useState<string>('');
  const [selectedLp, setSelectedLp] = useState<string>('');

  const [loadingGrades, setLoadingGrades] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [loadingLps, setLoadingLps] = useState(false);

  const [opening, setOpening] = useState(false);

  // 6-12 only: the render she is waiting on, and when it started.
  // `lessons612RefreshKey` is bumped whenever that list could have changed — she should not
  // have to reload the page to see the lesson she just asked for.
  const [lessons612RefreshKey, setLessons612RefreshKey] = useState(0);
  const [waitingRender, setWaitingRender] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  /**
   * WHICH CORPUS THIS GRADE BELONGS TO — read off the grade list, never inferred from the
   * number. A `grade <= 5` test would be a second, silent copy of a boundary the two services
   * already own, and it would answer confidently for a grade that neither of them offers.
   */
  const lane: Lane = grades.find((g) => String(g.grade) === selectedGrade)?.lane ?? 'k5';

  // ─── Fetch grades on mount ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    portal.getConfig().then((cfg) => {
      if (cancelled) return;
      setAssessmentEnabled(!!cfg?.features?.assessmentGenerator);
      setAssessmentMessage(cfg?.features?.assessmentGeneratorMessage ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // BOTH lanes, in one list, ordered 1..12.
        //
        // Settled independently: the 6-12 corpus failing to answer must not cost a teacher the
        // K-5 lessons that are sitting right there (and the reverse). `allSettled` means one
        // service being down degrades the list rather than emptying it.
        const [k5, g612] = await Promise.allSettled([
          api.get('/curriculum/grades'),
          api.get('/lp612/grades'),
        ]);

        const merged: Grade[] = [];
        if (k5.status === 'fulfilled') {
          for (const g of k5.value.data.grades || []) merged.push({ ...g, lane: 'k5' });
        }
        if (g612.status === 'fulfilled') {
          for (const g of g612.value.data.grades || []) merged.push({ ...g, lane: 'g612' });
        }
        if (!merged.length) throw new Error('no grades');

        setGrades(merged.sort((a, b) => a.grade - b.grade));
      } catch {
        toast({ title: 'Could not load grades', variant: 'destructive' });
      } finally {
        setLoadingGrades(false);
      }
    })();
  }, [toast]);

  // ─── Grade change → fetch subjects; reset downstream ───────────────────
  useEffect(() => {
    setSubjects([]); setChapters([]); setLps([]);
    setSelectedSubject(''); setSelectedChapter(''); setSelectedLp('');
    if (!selectedGrade) return;
    (async () => {
      setLoadingSubjects(true);
      try {
        const { data } = lane === 'g612'
          ? await api.get('/lp612/subjects', { params: { grade: selectedGrade } })
          : await api.get('/curriculum/subjects', { params: { grade: selectedGrade } });
        setSubjects((data.subjects || []).map((x: Record<string, unknown>) => ({
          // 6-12 has no subject_key — the display name IS the key it wants back.
          key: String(x.subject_key ?? x.subject),
          label: String(x.subject),
          lesson_count: Number(x.lesson_count ?? 0),
        })));
      } catch {
        toast({ title: 'Could not load subjects', variant: 'destructive' });
      } finally { setLoadingSubjects(false); }
    })();
  }, [selectedGrade, lane, toast]);

  // ─── Subject change → fetch chapters; reset downstream ─────────────────
  useEffect(() => {
    setChapters([]); setLps([]);
    setSelectedChapter(''); setSelectedLp('');
    if (!selectedGrade || !selectedSubject) return;
    (async () => {
      setLoadingChapters(true);
      try {
        const { data } = lane === 'g612'
          ? await api.get('/lp612/chapters', { params: { grade: selectedGrade, subject: selectedSubject } })
          : await api.get('/curriculum/chapters', { params: { grade: selectedGrade, subject: selectedSubject } });
        setChapters((data.chapters || []).map((c: Record<string, unknown>) => ({
          // K-5 addresses a chapter by number; 6-12 by chapter_key, because one grade+subject
          // can span two books and both can hold a chapter 1.
          key: String(c.chapter_key ?? c.chapter_number),
          chapter_number: Number(c.chapter_number ?? 0),
          chapter_title: String(c.chapter_title ?? ''),
          pages_label: (c.pages_label as string) ?? null,
          lesson_count: Number(c.lesson_count ?? 0),
        })));
      } catch {
        toast({ title: 'Could not load chapters', variant: 'destructive' });
      } finally { setLoadingChapters(false); }
    })();
  }, [selectedGrade, selectedSubject, lane, toast]);

  // ─── Chapter change → fetch LPs; reset downstream ──────────────────────
  useEffect(() => {
    setLps([]);
    setSelectedLp('');
    if (!selectedGrade || !selectedSubject || !selectedChapter) return;
    (async () => {
      setLoadingLps(true);
      try {
        if (lane === 'g612') {
          const { data } = await api.get('/lp612/lessons', {
            params: {
              grade: selectedGrade, subject: selectedSubject,
              chapter_key: selectedChapter, lang: 'en',
            },
          });
          setLps((data.lessons || []).map((l: Record<string, unknown>) => ({
            id: String(l.segment_id),
            title: String(l.title ?? ''),
            pages_label: (l.pages_label as string) ?? null,
            ready: l.ready === true,
            subtitle: null,
          })));
          return;
        }
        const { data } = await api.get('/curriculum/lps', {
          params: {
            grade: selectedGrade, subject: selectedSubject,
            chapter_number: selectedChapter,
          },
        });
        setLps((data.lessons || []).map((l: Record<string, unknown>) => ({
          id: String(l.lesson_id),
          title: String(l.topic || l.section || `Lesson ${l.segment_index}`),
          pages_label: (l.pages_label as string) ?? null,
          downloaded: l.downloaded === true,
          subtitle: (l.day_label as string) || null,
        })));
      } catch {
        toast({ title: 'Could not load lesson plans', variant: 'destructive' });
      } finally { setLoadingLps(false); }
    })();
  }, [selectedGrade, selectedSubject, selectedChapter, lane, toast]);

  const chosenLp: LessonPlan | undefined = lps.find(lp => lp.id === selectedLp);

  // ─── Open the lesson's PDF in a new tab (presigned R2 URL) ─────────────
  const openPdf = useCallback(async (kind: 'lesson' | 'answer_key' = 'lesson') => {
    if (!chosenLp) return;
    setOpening(true);
    try {
      const { data } = await api.get(`/curriculum/lp/${chosenLp.id}/pdf`, { params: { kind } });
      if (data.available && data.url) {
        window.open(data.url, '_blank', 'noopener');
      } else {
        toast({
          title: 'Not ready yet',
          description: 'This lesson has not been published. Please try another, or check back soon.',
        });
      }
    } catch {
      toast({ title: 'Could not open this lesson plan', variant: 'destructive' });
    } finally { setOpening(false); }
  }, [chosenLp, toast]);

  /** Open a finished 6-12 render. The link is minted per click — a presigned URL expires. */
  const open612 = useCallback(async (renderId: string) => {
    const { data } = await api.get(`/lp612/status/${renderId}`);
    if (data.state === 'ready' && data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  }, []);

  /**
   * Poll one 6-12 render to completion, widening the interval as the wait lengthens.
   *
   * A three-minute job polled every two seconds is ninety requests for one answer that changes
   * once. Start responsive so a fast render does not feel slow, then back off.
   */
  const poll612 = useCallback((renderId: string, startedAt: number) => {
    const tick = async () => {
      try {
        const { data } = await api.get(`/lp612/status/${renderId}`);
        if (data.state === 'ready') {
          setWaitingRender(null); setWaitingSince(null); setOpening(false);
          setLessons612RefreshKey((k) => k + 1);
          toast({ title: 'Your lesson plan is ready' });
          if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
          return;
        }
        if (data.state === 'failed') {
          setWaitingRender(null); setWaitingSince(null); setOpening(false);
          setLessons612RefreshKey((k) => k + 1);
          toast({
            title: 'That lesson could not be written',
            description: 'Try again — it usually works on a second attempt.',
            variant: 'destructive',
          });
          return;
        }
      } catch {
        // A dropped poll is not a failed render — the job runs on a worker whether or not this
        // browser can reach us. Keep asking rather than declaring it lost.
      }
      const waited = Date.now() - startedAt;
      pollTimer.current = setTimeout(tick, waited < 30_000 ? 3_000 : waited < 120_000 ? 6_000 : 12_000);
    };
    pollTimer.current = setTimeout(tick, 3_000);
  }, [toast]);

  /** The 6-12 action: open it if it exists, otherwise ask for it to be written. */
  const request612 = useCallback(async () => {
    if (!chosenLp) return;
    setOpening(true);
    try {
      const { data } = await api.post('/lp612/request', { segment_id: chosenLp.id, lang: 'en' });
      if (data.state === 'ready') {
        await open612(data.renderId);
        setOpening(false);
        return;
      }
      setWaitingRender(data.renderId);
      setWaitingSince(Date.now());
      // Listed as "Writing…" straight away, so leaving the page now still leaves a trail back.
      setLessons612RefreshKey((k) => k + 1);
      poll612(data.renderId, Date.now());
    } catch (err: unknown) {
      setOpening(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast({
        title: status === 403 ? 'That lesson is not available yet'
          : status === 404 ? 'That lesson is not in the catalogue'
            : 'Could not start that lesson',
        variant: 'destructive',
      });
    }
  }, [chosenLp, open612, poll612, toast]);

  if (loadingGrades) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-light">Curriculum Library</h1>
          </div>
          <p className="text-muted-foreground">
            Browse ready-made lesson plans, or generate a curriculum-based assessment.
          </p>
        </div>

        <Tabs defaultValue="library" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="library">Lesson Plans</TabsTrigger>
            <TabsTrigger value="assessment">Assessment Generator</TabsTrigger>
          </TabsList>

          <TabsContent value="library">
        {/* Cascading picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Grade */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">1. Grade</label>
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger><SelectValue placeholder="Select grade..." /></SelectTrigger>
              <SelectContent>
                {grades.map(g => (
                  <SelectItem key={g.grade} value={String(g.grade)}>
                    Grade {g.grade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">2. Subject</label>
            <Select value={selectedSubject} onValueChange={setSelectedSubject} disabled={!selectedGrade || loadingSubjects}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedGrade ? 'Select grade first' :
                  loadingSubjects ? 'Loading...' :
                  subjects.length === 0 ? 'No subjects' :
                  'Select subject...'
                } />
              </SelectTrigger>
              <SelectContent>
                {subjects.map(s => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label} <span className="text-muted-foreground text-xs">({s.lesson_count} lessons)</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Chapter */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">3. Chapter</label>
            <Select value={selectedChapter} onValueChange={setSelectedChapter} disabled={!selectedSubject || loadingChapters}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedSubject ? 'Select subject first' :
                  loadingChapters ? 'Loading...' :
                  chapters.length === 0 ? 'No chapters' :
                  'Select chapter...'
                } />
              </SelectTrigger>
              <SelectContent>
                {chapters.map(c => (
                  <SelectItem key={c.key} value={c.key}>
                    <span className="font-medium">Ch {c.chapter_number}: {c.chapter_title}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      {c.pages_label ? `· ${c.pages_label} ` : ''}· {c.lesson_count} lessons
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Lesson Plan */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">4. Lesson Plan</label>
            <Select value={selectedLp} onValueChange={setSelectedLp} disabled={!selectedChapter || loadingLps}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedChapter ? 'Select chapter first' :
                  loadingLps ? 'Loading...' :
                  lps.length === 0 ? 'No lessons' :
                  'Select lesson plan...'
                } />
              </SelectTrigger>
              <SelectContent>
                {lps.map(lp => (
                  <SelectItem key={lp.id} value={lp.id}>
                    {/* K-5: the same ✓/○ the WhatsApp picker shows, from the same record.
                        6-12: no tick — the useful fact is whether it has been WRITTEN, which
                        is said on the right, because tapping an unwritten one costs 3 minutes. */}
                    {lane === 'k5' && <span className="mr-1">{lp.downloaded ? '✓' : '○'}</span>}
                    {lp.subtitle && <span className="font-medium">{lp.subtitle}: </span>}
                    <span>{lp.title}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      {lp.pages_label ? `· ${lp.pages_label}` : ''}
                      {lane === 'g612' ? (lp.ready ? ' · ready now' : ' · takes ~3 min') : ''}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action area — appears once a lesson is selected */}
        {chosenLp && (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  {[chosenLp.subtitle, chosenLp.pages_label].filter(Boolean).join(' · ')}
                </div>
                <h2 className="text-xl font-medium">{chosenLp.title}</h2>
              </div>
              {lane === 'k5' && chosenLp.downloaded && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  ✓ already sent to you
                </span>
              )}
            </div>

            {/* K-5: every lesson the picker offers has a rendered PDF — that is what
                being offered means. The answer key is a separate asset and is not
                present for every lesson, so its button is only useful once tapped;
                the endpoint answers "not ready" rather than failing. */}
            {lane === 'k5' && (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => openPdf('lesson')} disabled={opening} className="flex items-center gap-2">
                  {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  Open lesson plan
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openPdf('answer_key')}
                  disabled={opening}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Answer key
                </Button>
              </div>
            )}

            {/* 6-12: the same slot, a different promise. About 92% of this corpus has
                not been written yet, so the button says which of the two things it is
                about to do, and the three-minute cost is stated BEFORE she commits —
                never discovered afterwards. */}
            {lane === 'g612' && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={request612} disabled={opening || !!waitingRender} className="flex items-center gap-2">
                    {(opening || waitingRender)
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <ExternalLink className="w-4 h-4" />}
                    {chosenLp.ready ? 'Open lesson plan' : 'Write this lesson plan'}
                  </Button>
                  {!chosenLp.ready && !waitingRender && (
                    <span className="text-sm text-muted-foreground">
                      Not written yet — this takes about 3 minutes.
                    </span>
                  )}
                </div>

                {waitingSince && (
                  <div className="rounded-lg border bg-muted/40 p-4 mt-4">
                    <div className="flex items-center gap-2 font-medium">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Writing your lesson plan…
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      About three minutes. Keep this page open and it will open by itself
                      when it is done.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* The landing place for a three-minute wait. Hidden entirely until she has asked for
            a 6-12 lesson, so a teacher who only ever uses grades 1-5 never sees it. */}
        <MyLesson612Panel refreshKey={lessons612RefreshKey} />
          </TabsContent>

          <TabsContent value="assessment">
            {/* bd-2460 — the tab stays visible on purpose: a teacher who has heard
                about the feature and cannot find it just asks support. The
                message matches what the bot says, and the API refuses too. */}
            {assessmentEnabled === null
              ? null
              : assessmentEnabled
                ? (
                  <div className="space-y-10">
                    <AssessmentGeneratorPanel
                      onPaperReady={() => setPapersRefreshKey((k) => k + 1)}
                    />

                    {/* My papers lives INSIDE this tab, under the generator,
                        rather than as a third tab beside it. Making a paper and
                        fetching one you already made are the same job — the
                        Curriculum page's tabs are for different KINDS of thing
                        (lesson plans vs assessments), not for steps within one.
                        A top-level tab also implied papers exist independently
                        of the generator, which they do not. */}
                    <section className="border-t pt-8">
                      <h3 className="mb-1 text-lg font-medium">My papers</h3>
                      <p className="mb-4 text-sm text-muted-foreground">
                        Everything you have made. Download it again any time.
                      </p>
                      <AssessmentPapersPanel refreshKey={papersRefreshKey} />
                    </section>
                  </div>
                )
                : <AssessmentGeneratorComingSoon message={assessmentMessage} />}
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
};

export default PortalCurriculum;
