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

import { useState, useEffect, useCallback } from 'react';
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

type Grade = { grade: number; subject_count: number };
type Subject = { subject_key: string; subject: string; rtl: boolean; lesson_count: number };
type Chapter = {
  chapter_number: number;
  chapter_title: string;
  pages_label: string | null;
  lesson_count: number;
};
type LessonPlan = {
  lesson_id: string;
  segment_index: number;
  lp_type: string;
  day_label: string | null;
  section: string | null;
  topic: string | null;
  pages_label: string | null;
  downloaded: boolean;
};

const PortalCurriculum = () => {
  const { toast } = useToast();

  // bd-2460 — null while loading, so the tab never flashes a form that is off.
  const [assessmentEnabled, setAssessmentEnabled] = useState<boolean | null>(null);
  const [assessmentMessage, setAssessmentMessage] = useState<string | null>(null);
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
        const { data } = await api.get('/curriculum/grades');
        setGrades(data.grades || []);
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
        const { data } = await api.get('/curriculum/subjects', { params: { grade: selectedGrade } });
        setSubjects(data.subjects || []);
      } catch {
        toast({ title: 'Could not load subjects', variant: 'destructive' });
      } finally { setLoadingSubjects(false); }
    })();
  }, [selectedGrade, toast]);

  // ─── Subject change → fetch chapters; reset downstream ─────────────────
  useEffect(() => {
    setChapters([]); setLps([]);
    setSelectedChapter(''); setSelectedLp('');
    if (!selectedGrade || !selectedSubject) return;
    (async () => {
      setLoadingChapters(true);
      try {
        const { data } = await api.get('/curriculum/chapters', {
          params: { grade: selectedGrade, subject: selectedSubject },
        });
        setChapters(data.chapters || []);
      } catch {
        toast({ title: 'Could not load chapters', variant: 'destructive' });
      } finally { setLoadingChapters(false); }
    })();
  }, [selectedGrade, selectedSubject, toast]);

  // ─── Chapter change → fetch LPs; reset downstream ──────────────────────
  useEffect(() => {
    setLps([]);
    setSelectedLp('');
    if (!selectedGrade || !selectedSubject || !selectedChapter) return;
    (async () => {
      setLoadingLps(true);
      try {
        const { data } = await api.get('/curriculum/lps', {
          params: {
            grade: selectedGrade, subject: selectedSubject,
            chapter_number: selectedChapter,
          },
        });
        setLps(data.lessons || []);
      } catch {
        toast({ title: 'Could not load lesson plans', variant: 'destructive' });
      } finally { setLoadingLps(false); }
    })();
  }, [selectedGrade, selectedSubject, selectedChapter, toast]);

  const chosenLp: LessonPlan | undefined = lps.find(lp => lp.lesson_id === selectedLp);

  // ─── Open the lesson's PDF in a new tab (presigned R2 URL) ─────────────
  const openPdf = useCallback(async (kind: 'lesson' | 'answer_key' = 'lesson') => {
    if (!chosenLp) return;
    setOpening(true);
    try {
      const { data } = await api.get(`/curriculum/lp/${chosenLp.lesson_id}/pdf`, { params: { kind } });
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
                  <SelectItem key={s.subject_key} value={s.subject_key}>
                    {s.subject} <span className="text-muted-foreground text-xs">({s.lesson_count} lessons)</span>
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
                  <SelectItem key={c.chapter_number} value={String(c.chapter_number)}>
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
                  <SelectItem key={lp.lesson_id} value={lp.lesson_id}>
                    {/* The same ✓/○ the WhatsApp picker shows, from the same record. */}
                    <span className="mr-1">{lp.downloaded ? '✓' : '○'}</span>
                    <span className="font-medium">{lp.day_label || `Lesson ${lp.segment_index}`}:</span>{' '}
                    <span>{lp.topic || lp.section}</span>
                    {lp.pages_label && (
                      <span className="text-muted-foreground text-xs ml-2">· {lp.pages_label}</span>
                    )}
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
                  {[chosenLp.day_label, chosenLp.section, chosenLp.pages_label]
                    .filter(Boolean).join(' · ')}
                </div>
                <h2 className="text-xl font-medium">{chosenLp.topic || chosenLp.section}</h2>
              </div>
              {chosenLp.downloaded && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  ✓ already sent to you
                </span>
              )}
            </div>

            {/* Every lesson the picker offers has a rendered PDF — that is what
                being offered means. The answer key is a separate asset and is
                not present for every lesson, so its button is only useful once
                tapped; the endpoint answers "not ready" rather than failing. */}
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
          </div>
        )}
          </TabsContent>

          <TabsContent value="assessment">
            {/* bd-2460 — the tab stays visible on purpose: a teacher who has heard
                about the feature and cannot find it just asks support. The
                message matches what the bot says, and the API refuses too. */}
            {assessmentEnabled === null
              ? null
              : assessmentEnabled
                ? <AssessmentGeneratorPanel />
                : <AssessmentGeneratorComingSoon message={assessmentMessage} />}
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
};

export default PortalCurriculum;
