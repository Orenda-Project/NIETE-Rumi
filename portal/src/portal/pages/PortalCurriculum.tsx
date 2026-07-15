/**
 * PortalCurriculum — 4-step cascading picker for the 2,415-LP corpus.
 *
 *   Grade ▼   Subject ▼   Chapter ▼   Lesson Plan ▼    [ View PDF → ]
 *
 * Each dropdown fetches its options from a dedicated backend endpoint,
 * populated based on the previous selection. When an LP is selected:
 *   - if the language's PDF is cached in R2, the "View PDF" button opens
 *     a presigned URL in a new tab
 *   - if not cached, a "Prepare this LP" button queues an async Gamma
 *     render (same pipeline the WhatsApp bot uses); the teacher gets a
 *     "Ready in ~2 min, refresh to check" note
 *
 * Data axes:
 *   - Publisher badge shown on chapters (NBF vs Taleemabad — same
 *     chapter_number can exist under both)
 *   - Language badges [EN] [UR] on each LP, active only when cached;
 *     clicking opens that language variant
 */

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, ExternalLink, Loader2, Sparkles, Headphones, Video, CheckCircle2 } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type Grade = { grade: number; label: string; count: number };
type Subject = { subject: string; label: string; count: number };
type Chapter = { publisher: string; chapter_number: number; chapter_title: string; lp_count: number };
type LessonPlan = {
  source_lp_uuid: string;
  lp_index: number;
  topic: string;
  publisher: string;
  chapter_title: string;
  available_en: boolean;
  available_ur: boolean;
  // FEAT-059 enrichment flags — the LP has an accompanying voicenote / demo video
  has_voicenote: boolean;
  has_video: boolean;
  review_status: 'unreviewed' | 'approved' | 'rejected' | 'needs_changes';
  rendered_at: string | null;
};

// The extended /pdf endpoint returns these fields alongside the PDF metadata.
type LpMedia = {
  voicenote_url: string | null;
  video_url: string | null;
  review_status: 'unreviewed' | 'approved' | 'rejected' | 'needs_changes';
  review_notes: string | null;
};

const PortalCurriculum = () => {
  const { toast } = useToast();

  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lps, setLps] = useState<LessonPlan[]>([]);

  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  // chapter value encodes both publisher + chapter_number so the same
  // chapter_number under two publishers can coexist as distinct options.
  const [selectedChapter, setSelectedChapter] = useState<string>('');
  const [selectedLp, setSelectedLp] = useState<string>('');

  const [loadingGrades, setLoadingGrades] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [loadingLps, setLoadingLps] = useState(false);

  const [opening, setOpening] = useState(false);
  const [rendering, setRendering] = useState(false);

  // FEAT-059 enrichment media — voicenote + demo video URLs for the chosen LP.
  // Eagerly fetched on LP selection so the players appear alongside the PDF button.
  const [lpMedia, setLpMedia] = useState<LpMedia | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // ─── Fetch grades on mount ────────────────────────────────────────────
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
    const [publisher, chapterNumberStr] = selectedChapter.split('::');
    (async () => {
      setLoadingLps(true);
      try {
        const { data } = await api.get('/curriculum/lps', {
          params: {
            grade: selectedGrade, subject: selectedSubject,
            chapter_number: chapterNumberStr, publisher,
          },
        });
        setLps(data.lps || []);
      } catch {
        toast({ title: 'Could not load lesson plans', variant: 'destructive' });
      } finally { setLoadingLps(false); }
    })();
  }, [selectedGrade, selectedSubject, selectedChapter, toast]);

  const chosenLp: LessonPlan | undefined = lps.find(lp => lp.source_lp_uuid === selectedLp);

  // ─── Eager media fetch when an LP is selected ──────────────────────────
  // The extended /pdf endpoint returns voicenote_url + video_url alongside
  // the PDF metadata. Calling once on selection lets the audio/video players
  // render immediately, no click required. lang is arbitrary here — media
  // URLs are language-neutral (single-source-language per LP).
  useEffect(() => {
    setLpMedia(null);
    if (!chosenLp) return;
    if (!chosenLp.has_voicenote && !chosenLp.has_video) return;  // skip round-trip for unenriched LPs
    (async () => {
      setLoadingMedia(true);
      try {
        const langForCall = chosenLp.available_en ? 'en' : chosenLp.available_ur ? 'ur' : 'en';
        const { data } = await api.get(`/curriculum/lp/${chosenLp.source_lp_uuid}/pdf`, { params: { lang: langForCall } });
        setLpMedia({
          voicenote_url: data.voicenote_url || null,
          video_url: data.video_url || null,
          review_status: data.review_status || 'unreviewed',
          review_notes: data.review_notes || null,
        });
      } catch {
        // Silent — the buttons/players just don't render. Not a blocking failure.
      } finally {
        setLoadingMedia(false);
      }
    })();
  }, [chosenLp]);

  // ─── Open the cached PDF in a new tab (presigned R2 URL) ───────────────
  const openPdf = useCallback(async (lang: 'en' | 'ur') => {
    if (!chosenLp) return;
    setOpening(true);
    try {
      const { data } = await api.get(`/curriculum/lp/${chosenLp.source_lp_uuid}/pdf`, { params: { lang } });
      if (data.available && data.url) {
        window.open(data.url, '_blank', 'noopener');
      } else {
        toast({ title: 'Not yet available', description: 'Tap "Prepare this LP" to render it.' });
      }
    } catch {
      toast({ title: 'Could not open PDF', variant: 'destructive' });
    } finally { setOpening(false); }
  }, [chosenLp, toast]);

  // ─── Queue an async render for a not-yet-cached LP ─────────────────────
  const requestRender = useCallback(async (lang: 'en' | 'ur') => {
    if (!chosenLp) return;
    setRendering(true);
    try {
      const { data } = await api.post(`/curriculum/lp/${chosenLp.source_lp_uuid}/render`, { language: lang });
      if (data.alreadyAvailable) {
        toast({ title: 'Already ready', description: 'Opening the PDF now.' });
        openPdf(lang);
      } else if (data.queued) {
        toast({
          title: 'Preparing your lesson plan',
          description: 'Ready in about 2 minutes — refresh the page to check. You\'ll also get it on WhatsApp.',
        });
      }
    } catch {
      toast({ title: 'Could not queue this lesson plan', variant: 'destructive' });
    } finally { setRendering(false); }
  }, [chosenLp, toast, openPdf]);

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
            Browse ready-made lesson plans from NBF and Taleemabad. Pick your grade, subject, chapter, and lesson.
          </p>
        </div>

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
                    {g.label || `Grade ${g.grade}`} <span className="text-muted-foreground text-xs">({g.count} LPs)</span>
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
                  <SelectItem key={s.subject} value={s.subject}>
                    {s.label} <span className="text-muted-foreground text-xs">({s.count} LPs)</span>
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
                {chapters.map(c => {
                  const val = `${c.publisher}::${c.chapter_number}`;
                  return (
                    <SelectItem key={val} value={val}>
                      <span className="font-medium">Ch {c.chapter_number}: {c.chapter_title}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        · {c.publisher} · {c.lp_count} LPs
                      </span>
                    </SelectItem>
                  );
                })}
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
                  <SelectItem key={lp.source_lp_uuid} value={lp.source_lp_uuid}>
                    <span className="font-medium">Lesson {lp.lp_index}:</span>{' '}
                    <span>{lp.topic}</span>
                    <span className="text-xs ml-2">
                      {lp.available_en && <span className="text-green-600 mr-1">[EN]</span>}
                      {lp.available_ur && <span className="text-green-600 mr-1">[UR]</span>}
                      {lp.has_voicenote && <span title="Voicenote available" className="mr-1">🎧</span>}
                      {lp.has_video && <span title="Demo video available">🎥</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action area — appears once an LP is selected */}
        {chosenLp && (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  {chosenLp.publisher} · {chosenLp.chapter_title}
                </div>
                <h2 className="text-xl font-medium">{chosenLp.topic}</h2>
              </div>
              {/* Reviewed-and-approved badge — earned via the FEAT-059 review sheet */}
              {lpMedia?.review_status === 'approved' && (
                <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Reviewed
                </div>
              )}
            </div>

            {/* Available languages — cached PDFs */}
            {(chosenLp.available_en || chosenLp.available_ur) ? (
              <div className="flex flex-wrap gap-3">
                {chosenLp.available_en && (
                  <Button onClick={() => openPdf('en')} disabled={opening} className="flex items-center gap-2">
                    {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    View PDF (English)
                  </Button>
                )}
                {chosenLp.available_ur && (
                  <Button onClick={() => openPdf('ur')} disabled={opening} variant="outline" className="flex items-center gap-2">
                    {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    View PDF (اردو)
                  </Button>
                )}
                {/* Optional: offer the other language if only one is cached */}
                {chosenLp.available_en && !chosenLp.available_ur && (
                  <Button onClick={() => requestRender('ur')} disabled={rendering} variant="ghost" size="sm">
                    {rendering ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                    Prepare Urdu version
                  </Button>
                )}
                {!chosenLp.available_en && chosenLp.available_ur && (
                  <Button onClick={() => requestRender('en')} disabled={rendering} variant="ghost" size="sm">
                    {rendering ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                    Prepare English version
                  </Button>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  This lesson plan hasn't been prepared yet. Tap the button below and we'll get it ready in about 2 minutes.
                  You'll also receive it on WhatsApp.
                </p>
                <Button onClick={() => requestRender('en')} disabled={rendering} className="flex items-center gap-2">
                  {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Prepare this lesson plan
                </Button>
              </div>
            )}

            {/* FEAT-059 enrichment: voicenote + demo video inline players.
                Rendered only when the LP has been enriched (imported assets).
                Media URLs are eagerly fetched via lpMedia state — no click required. */}
            {(chosenLp.has_voicenote || chosenLp.has_video) && (
              <div className="mt-6 pt-6 border-t space-y-4">
                {loadingMedia && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading audio & video...
                  </div>
                )}
                {lpMedia?.voicenote_url && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-sm font-medium text-foreground">
                      <Headphones className="w-4 h-4 text-primary" />
                      Voicenote — walkthrough narration
                    </div>
                    <audio controls preload="metadata" src={lpMedia.voicenote_url} className="w-full" />
                  </div>
                )}
                {lpMedia?.video_url && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-sm font-medium text-foreground">
                      <Video className="w-4 h-4 text-primary" />
                      Demo — teacher performing the lesson
                    </div>
                    <video
                      controls
                      preload="metadata"
                      src={lpMedia.video_url}
                      className="w-full rounded-md bg-black"
                      style={{ maxHeight: 480 }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalCurriculum;
