/**
 * PortalTraining — 3-step cascading picker for teacher training modules.
 *
 *     Level ▼          Course ▼          Module ▼
 *
 * Mirrors PortalCurriculum's UX AND the WhatsApp training Flow's lockdown:
 *   locked         previous level's grand quiz NOT passed (unless first level)
 *   certified      this level's grand quiz IS passed
 *   ready_for_quiz all courses started + grand quiz not yet passed
 *   in_progress    at least one course started
 *   not_started    no progress yet
 *
 * Locked levels appear in the dropdown with 🔒 and cannot be selected.
 * If a teacher somehow reaches a locked-level API (via URL manipulation),
 * the backend returns 403 and the toast surfaces "Pass Level N first".
 *
 * When a module is selected the detail card shows:
 *   - title, duration, completion badge
 *   - ▶ Inline HTML5 <video> player (presigned R2 URL as src)
 *   - 🎧 Inline HTML5 <audio> player (if audio_url present)
 *   - content_html rendered inline (sanitized via DOMPurify)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { GraduationCap, CheckCircle2, Circle, Loader2, Lock, Award, ClipboardCheck, Building2, FileText } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ModuleQuizPanel, { type SubmittedAttempt } from '../components/ModuleQuizPanel';
import LevelExamCard from '../components/LevelExamCard';
import CapstoneResultCard from '../components/CapstoneResultCard';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

// Per-vendor aggregate from GET /api/portal/training/vendors — one card
// per vendor in the "Content Provider" row at the top of the page.
type Vendor = {
  vendor_key: string;
  vendor_name: string;
  level_count: number;
  course_count: number;
  module_count: number;
  completed_module_count: number;
  avg_score_pct: number | null;
};

type LevelState = 'locked' | 'certified' | 'ready_for_quiz' | 'in_progress' | 'not_started';
type Level = {
  id: number; name: string; order_index: number; cpd_level: number | null;
  vendor_key?: string | null;
  unlock_logic?: string;
  state: LevelState;
  module_count: number; completed_count: number;
  courses_total: number; courses_completed: number;
  passed_at: string | null; cooldown_until: string | null;
  previous_level_order: number | null;
};
type Course = { id: string; title: string; course_type: string; order_index: number; module_count: number; completed_count: number };
type ModuleSummary = { id: string; title: string; order_index: number; duration_seconds: number; has_video: boolean; has_audio: boolean; has_pdf: boolean; completed_at: string | null };
type ModuleDetail = {
  id: string; title: string; content_html: string;
  video_url: string | null; audio_url: string | null;
  pdf_url: string | null; has_questions: boolean;
  duration_seconds: number; order_index: number; completed_at: string | null;
  course: { id: string; title: string } | null;
  level: { id: number; name: string } | null;
};
type QuizAttempt = {
  id: string;
  completed_at: string | null;
  score: number | null;
  max_score: number | null;
  quiz_kind: string;
};

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m}m ${s}s`;
}

// Given the list of quiz attempts for a module, return the teacher's best
// attempt. Attempts arrive chronological (ascending completed_at); "best" =
// highest score. Ties break to the most recent (last one wins in the reduce).
function bestAttempt(attempts: QuizAttempt[]): QuizAttempt | null {
  if (!attempts || attempts.length === 0) return null;
  return attempts.reduce((best, a) => {
    if (!best) return a;
    const bs = best.score ?? -1;
    const as = a.score ?? -1;
    return as >= bs ? a : best;
  }, null as QuizAttempt | null);
}

// The tiny inline badge next to the completion tick. Handles three shapes:
//   - no attempts yet (module not attempted): "—"
//   - completed with attempts: "3 / 3" with attempt-count subline if >1
//   - completed but zero attempts (edge case — module without questions or
//     the WhatsApp attempt never persisted): "Not attempted"
function QuizScoreBadge({
  attempts,
  moduleCompleted,
  loading,
}: {
  attempts: QuizAttempt[] | null;
  moduleCompleted: boolean;
  loading: boolean;
}) {
  if (loading) {
    return <span className="text-xs text-muted-foreground" data-testid="quiz-score-loading">…</span>;
  }
  if (!attempts || attempts.length === 0) {
    if (moduleCompleted) {
      return <span className="text-xs text-muted-foreground" data-testid="quiz-score-not-attempted">Not attempted</span>;
    }
    return <span className="text-xs text-muted-foreground" data-testid="quiz-score-none">—</span>;
  }
  const best = bestAttempt(attempts);
  if (!best || best.score == null || best.max_score == null) {
    return <span className="text-xs text-muted-foreground" data-testid="quiz-score-none">—</span>;
  }
  const pct = best.max_score > 0 ? Math.round((best.score / best.max_score) * 100) : 0;
  const tone =
    pct >= 80 ? 'text-green-700 bg-green-50 border-green-200'
    : pct >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${tone}`}
      data-testid="quiz-score-badge"
      title={attempts.length > 1 ? `Best of ${attempts.length} attempts` : 'Quiz score'}
    >
      Quiz: {best.score} / {best.max_score}
    </span>
  );
}

function levelStateBadge(l: Level) {
  switch (l.state) {
    case 'locked':         return { icon: <Lock className="w-3.5 h-3.5" />, label: `🔒 Locked · Pass L${(l.previous_level_order ?? 0) + 1} first`, className: 'text-muted-foreground' };
    case 'certified':      return { icon: <Award className="w-3.5 h-3.5" />, label: '🏆 Certified', className: 'text-green-700' };
    case 'ready_for_quiz': return { icon: <ClipboardCheck className="w-3.5 h-3.5" />, label: '📝 Ready for exam', className: 'text-amber-700' };
    case 'in_progress':    return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: `📖 ${l.completed_count}/${l.module_count} done`, className: 'text-primary' };
    default:               return { icon: <Circle className="w-3.5 h-3.5" />, label: 'Not started', className: 'text-muted-foreground' };
  }
}

// Reusable "avg quiz score" pill for the vendor cards. Same colour ladder
// (green ≥80, amber ≥50, red <50) as the per-module QuizScoreBadge above so
// the visual language is consistent across the page.
function VendorAvgScorePill({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid="vendor-avg-score-none"
      >
        Quiz avg: —
      </span>
    );
  }
  const tone =
    pct >= 80 ? 'text-green-700 bg-green-50 border-green-200'
    : pct >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${tone}`}
      data-testid="vendor-avg-score-badge"
    >
      Quiz avg: {pct}%
    </span>
  );
}

// Vendor-grouping strip at the top of the page. Click a card to filter the
// Level → Course → Module cascade below to only that vendor's content. The
// currently-selected card is highlighted with a ring; clicking it again
// clears the filter.
function VendorGrouping({
  vendors,
  selectedVendor,
  onSelect,
}: {
  vendors: Vendor[];
  selectedVendor: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (vendors.length === 0) return null;
  return (
    <div className="mb-6" data-testid="vendor-grouping">
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Content Provider</span>
        {selectedVendor && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs text-muted-foreground underline ml-2"
            data-testid="vendor-clear-filter"
          >
            Show all
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {vendors.map((v) => {
          const active = selectedVendor === v.vendor_key;
          return (
            <button
              key={v.vendor_key}
              type="button"
              onClick={() => onSelect(active ? null : v.vendor_key)}
              data-testid={`vendor-card-${v.vendor_key}`}
              className={`text-left rounded-lg border p-4 shadow-sm transition-colors hover:bg-muted/40 ${
                active ? 'ring-2 ring-primary border-primary bg-muted/30' : 'bg-card'
              }`}
            >
              <div className="font-medium text-sm mb-1">{v.vendor_name}</div>
              <div className="text-xs text-muted-foreground mb-2">
                {v.module_count} modules · {v.completed_module_count}/{v.module_count} done
              </div>
              <VendorAvgScorePill pct={v.avg_score_pct} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PortalTraining = () => {
  const { toast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);

  const [levels, setLevels] = useState<Level[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>('');

  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingLevels, setLoadingLevels] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Per-module quiz attempts, keyed by module id. Fetched once the module list
  // arrives; a single request per module. Null while in-flight, [] when the
  // teacher has none, populated array otherwise. The endpoint scopes to the
  // caller server-side (session's user_id), so no client-side filtering needed.
  const [attemptsByModule, setAttemptsByModule] = useState<Record<string, QuizAttempt[] | null>>({});

  // Fetch vendors + levels on mount, in parallel — both are read-only
  // roll-ups scoped to the caller server-side.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/training/vendors');
        setVendors(data.vendors || []);
      } catch {
        // Silent — the vendor strip is an enhancement; if it can't load the
        // page still works with the full unfiltered cascade below.
      } finally { setLoadingVendors(false); }
    })();
    (async () => {
      try {
        const { data } = await api.get('/training/levels');
        setLevels(data.levels || []);
      } catch {
        toast({ title: 'Could not load training levels', variant: 'destructive' });
      } finally { setLoadingLevels(false); }
    })();
  }, [toast]);

  // The full Level object for the current selection — drives the LevelExamCard
  // (grand quiz / level exam) below the cascade.
  const selectedLevelObj = useMemo(
    () => levels.find(l => String(l.id) === selectedLevel) ?? null,
    [levels, selectedLevel]
  );

  // Re-pull levels after a certification so the picker flips this level to
  // "Certified" and unlocks the next one without a page reload.
  const refreshLevels = useCallback(async () => {
    try {
      const { data } = await api.get('/training/levels');
      setLevels(data.levels || []);
    } catch { /* silent — the next mount refetches anyway */ }
  }, []);

  // Levels filtered by the selected vendor card. When no vendor is picked, all
  // levels show (matches the pre-bd-2031 behaviour exactly). We derive this
  // via useMemo so switching vendors is instant and doesn't reset the cascade
  // if the level being shown still belongs to the newly-selected vendor.
  const visibleLevels = useMemo(() => {
    if (!selectedVendor) return levels;
    return levels.filter(l => l.vendor_key === selectedVendor);
  }, [levels, selectedVendor]);

  // Clearing/changing the vendor may hide the currently-picked level; reset
  // the downstream cascade in that case so the UI doesn't leave stale
  // course/module state visible.
  useEffect(() => {
    if (!selectedLevel) return;
    if (!visibleLevels.some(l => String(l.id) === selectedLevel)) {
      setSelectedLevel('');
      setSelectedCourse('');
      setSelectedModule('');
      setCourses([]);
      setModules([]);
      setModuleDetail(null);
    }
  }, [visibleLevels, selectedLevel]);

  // Level → courses. Reject selection if the chosen level is locked
  // (defence-in-depth; the Select item is also greyed out).
  const handleLevelChange = useCallback((val: string) => {
    const lvl = levels.find(l => String(l.id) === val);
    if (lvl && lvl.state === 'locked') {
      toast({
        title: 'Level locked',
        description: `Pass the Level ${lvl.previous_level_order ?? 0} grand quiz first.`,
      });
      return;
    }
    setSelectedLevel(val);
  }, [levels, toast]);

  useEffect(() => {
    setCourses([]); setModules([]); setModuleDetail(null);
    setSelectedCourse(''); setSelectedModule('');
    if (!selectedLevel) return;
    (async () => {
      setLoadingCourses(true);
      try {
        const { data } = await api.get('/training/courses', { params: { level_id: selectedLevel } });
        setCourses(data.courses || []);
      } catch (err: any) {
        const msg = err?.response?.data?.error || 'Could not load courses';
        toast({ title: msg, variant: 'destructive' });
      } finally { setLoadingCourses(false); }
    })();
  }, [selectedLevel, toast]);

  // Course → modules
  useEffect(() => {
    setModules([]); setModuleDetail(null);
    setSelectedModule('');
    setAttemptsByModule({});
    if (!selectedCourse) return;
    (async () => {
      setLoadingModules(true);
      try {
        const { data } = await api.get('/training/modules', { params: { course_id: selectedCourse } });
        const list: ModuleSummary[] = data.modules || [];
        setModules(list);
        // Fire-and-forget per-module attempt lookups so each row's Quiz
        // Score badge fills in as it arrives. Mark each as "loading" (null
        // in the map — the badge component treats missing key as "not yet
        // fetched" and shows nothing until we set it).
        const nextMap: Record<string, QuizAttempt[] | null> = {};
        for (const m of list) nextMap[m.id] = null;
        setAttemptsByModule(nextMap);
        for (const m of list) {
          // Each request is independent; no need to await sequentially.
          api.get(`/training/module/${m.id}/attempts`)
            .then(({ data }) => {
              setAttemptsByModule(prev => ({ ...prev, [m.id]: data.attempts || [] }));
            })
            .catch(() => {
              // Silent — the badge falls back to "—" when the fetch fails.
              // We don't toast per-module to avoid noise on transient errors.
              setAttemptsByModule(prev => ({ ...prev, [m.id]: [] }));
            });
        }
      } catch {
        toast({ title: 'Could not load modules', variant: 'destructive' });
      } finally { setLoadingModules(false); }
    })();
  }, [selectedCourse, toast]);

  // After a portal quiz submit: refresh the module's attempt list (so the
  // score badge updates) and mark the module complete locally (the backend
  // upserts teacher_training_progress as part of the submit).
  const handleQuizSubmitted = useCallback((attempt: SubmittedAttempt) => {
    const moduleId = selectedModule;
    if (!moduleId) return;
    api.get(`/training/module/${moduleId}/attempts`)
      .then(({ data }) => {
        setAttemptsByModule(prev => ({ ...prev, [moduleId]: data.attempts || [] }));
      })
      .catch(() => {
        // Fall back to appending the attempt we just got so the badge still updates.
        setAttemptsByModule(prev => ({
          ...prev,
          [moduleId]: [
            ...(prev[moduleId] || []),
            { id: attempt.id, completed_at: attempt.completed_at, score: attempt.score, max_score: attempt.max_score, quiz_kind: 'training_module' },
          ],
        }));
      });
    const completedAt = attempt.completed_at || new Date().toISOString();
    setModules(prev => prev.map(m => (m.id === moduleId && !m.completed_at ? { ...m, completed_at: completedAt } : m)));
    setModuleDetail(prev => (prev && prev.id === moduleId && !prev.completed_at ? { ...prev, completed_at: completedAt } : prev));
  }, [selectedModule]);

  // Module → detail
  useEffect(() => {
    setModuleDetail(null);
    if (!selectedModule) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const { data } = await api.get(`/training/module/${selectedModule}`);
        setModuleDetail(data.module);
      } catch {
        toast({ title: 'Could not load module', variant: 'destructive' });
      } finally { setLoadingDetail(false); }
    })();
  }, [selectedModule, toast]);

  // "Mark complete" for quiz-less modules — modules WITH questions complete
  // through quiz submission instead, so this only fires when has_questions
  // is false. On success the detail card and the module dropdown both flip
  // to the completed state without a refetch.
  const [markingComplete, setMarkingComplete] = useState(false);
  const handleMarkComplete = useCallback(async () => {
    if (!moduleDetail || markingComplete) return;
    setMarkingComplete(true);
    try {
      const { data } = await api.post(`/training/module/${moduleDetail.id}/complete`);
      const completedAt: string = data.completed_at;
      setModuleDetail(prev => (prev ? { ...prev, completed_at: completedAt } : prev));
      setModules(prev => prev.map(m => (m.id === moduleDetail.id ? { ...m, completed_at: completedAt } : m)));
      toast({ title: 'Module marked complete' });
    } catch (err) {
      const resp = (err as { response?: { data?: { error?: string } } })?.response;
      const msg = resp?.data?.error || 'Could not mark module complete';
      toast({ title: msg, variant: 'destructive' });
    } finally { setMarkingComplete(false); }
  }, [moduleDetail, markingComplete, toast]);

  if (loadingLevels || loadingVendors) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <GraduationCap className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-light">Teacher Training</h1>
          </div>
          <p className="text-muted-foreground">
            Browse your training levels, courses, and modules. Levels unlock as you pass each grand quiz on WhatsApp.
          </p>
        </div>

        {/* Vendor grouping — click a card to filter the cascade below */}
        <VendorGrouping
          vendors={vendors}
          selectedVendor={selectedVendor}
          onSelect={setSelectedVendor}
        />

        {/* Cascading picker */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Level */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">1. Level</label>
            <Select value={selectedLevel} onValueChange={handleLevelChange}>
              <SelectTrigger><SelectValue placeholder="Select level..." /></SelectTrigger>
              <SelectContent>
                {visibleLevels.map(l => {
                  const badge = levelStateBadge(l);
                  const locked = l.state === 'locked';
                  return (
                    <SelectItem key={l.id} value={String(l.id)} disabled={locked} className={locked ? 'opacity-60' : ''}>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {locked && '🔒 '}
                          {(l.unlock_logic || 'chain') === 'chain' ? `Level ${l.order_index} · ${l.name}` : l.name}
                        </span>
                        <span className={`text-xs mt-0.5 ${badge.className}`}>{badge.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Course */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">2. Course</label>
            <Select value={selectedCourse} onValueChange={setSelectedCourse} disabled={!selectedLevel || loadingCourses}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedLevel ? 'Select level first' :
                  loadingCourses ? 'Loading...' :
                  courses.length === 0 ? 'No courses' : 'Select course...'
                } />
              </SelectTrigger>
              <SelectContent>
                {courses.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-medium">{c.title}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      · {c.completed_count}/{c.module_count} done
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Module */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">3. Module</label>
            <Select value={selectedModule} onValueChange={setSelectedModule} disabled={!selectedCourse || loadingModules}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedCourse ? 'Select course first' :
                  loadingModules ? 'Loading...' :
                  modules.length === 0 ? 'No modules' : 'Select module...'
                } />
              </SelectTrigger>
              <SelectContent>
                {modules.map(m => {
                  const attempts = attemptsByModule[m.id];
                  // Loading = key exists but value is null (in-flight).
                  const loading = m.id in attemptsByModule && attempts === null;
                  return (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="mr-1">{m.completed_at ? '✓' : '○'}</span>
                      <span className="font-medium">{m.title}</span>
                      {m.duration_seconds > 0 && (
                        <span className="text-muted-foreground text-xs ml-2">· {formatDuration(m.duration_seconds)}</span>
                      )}
                      <span className="ml-2">
                        <QuizScoreBadge
                          attempts={attempts ?? null}
                          moduleCompleted={!!m.completed_at}
                          loading={loading}
                        />
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* BH written capstone record (taken on WhatsApp) — bd-2233 */}
        {selectedLevelObj && (selectedLevelObj.unlock_logic || 'chain') !== 'chain' && (
          <CapstoneResultCard
            key={`cap-${selectedLevelObj.id}`}
            levelId={selectedLevelObj.id}
            levelName={selectedLevelObj.name}
          />
        )}

        {/* Level exam (grand quiz) — entry point, exam form, and result */}
        {selectedLevelObj && selectedLevelObj.state !== 'locked' && (
          <div className="mb-6">
            <LevelExamCard
              key={selectedLevelObj.id}
              levelId={selectedLevelObj.id}
              levelName={selectedLevelObj.name}
              levelOrderIndex={selectedLevelObj.order_index}
              onCertified={refreshLevels}
            />
          </div>
        )}

        {/* Detail card */}
        {loadingDetail && (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {moduleDetail && !loadingDetail && (
          <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                {moduleDetail.level && moduleDetail.course && (
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {moduleDetail.level.name} · {moduleDetail.course.title}
                  </div>
                )}
                <h2 className="text-xl font-medium">{moduleDetail.title}</h2>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  {moduleDetail.duration_seconds > 0 && <span>{formatDuration(moduleDetail.duration_seconds)}</span>}
                  {moduleDetail.completed_at ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="w-4 h-4" /> Completed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Circle className="w-4 h-4" /> Not yet
                    </span>
                  )}
                  <QuizScoreBadge
                    attempts={attemptsByModule[moduleDetail.id] ?? null}
                    moduleCompleted={!!moduleDetail.completed_at}
                    loading={moduleDetail.id in attemptsByModule && attemptsByModule[moduleDetail.id] === null}
                  />
                </div>
              </div>
            </div>

            {/* Inline video player */}
            {moduleDetail.video_url && (
              <div className="rounded-md overflow-hidden bg-black">
                <video
                  controls
                  className="w-full max-h-[560px] mx-auto"
                  preload="metadata"
                  src={moduleDetail.video_url}
                >
                  Your browser doesn't support inline video. <a href={moduleDetail.video_url} target="_blank" rel="noopener">Open the video in a new tab</a>.
                </video>
              </div>
            )}

            {/* Inline audio player */}
            {moduleDetail.audio_url && (
              <div className="rounded-md bg-muted p-3">
                <audio controls className="w-full" preload="metadata" src={moduleDetail.audio_url}>
                  Your browser doesn't support inline audio.
                </audio>
              </div>
            )}

            {/* PDF document — modules whose content is a document (no video/audio).
                Rendered as an open control rather than an inline embed: the files
                are large and mobile browsers handle a new-tab PDF far better. */}
            {moduleDetail.pdf_url && (
              <div className="rounded-md border bg-muted/40 p-4 flex items-center justify-between gap-4" data-testid="module-pdf-block">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-8 h-8 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{moduleDetail.title}</div>
                    <div className="text-xs text-muted-foreground">PDF document — opens in a new tab</div>
                  </div>
                </div>
                <a
                  href={moduleDetail.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                  data-testid="module-pdf-open"
                >
                  Open PDF
                </a>
              </div>
            )}

            {/* HTML content */}
            {moduleDetail.content_html && moduleDetail.content_html.trim().length > 0 ? (
              <div
                className="prose prose-sm max-w-none border-t pt-4"
                // eslint-disable-next-line react/no-danger — DOMPurify sanitises before render
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(moduleDetail.content_html) }}
              />
            ) : (
              !moduleDetail.video_url && !moduleDetail.audio_url && !moduleDetail.pdf_url && (
                <p className="text-sm text-muted-foreground border-t pt-4">
                  This module has no readable content yet. It's likely a checkpoint or reflection module.
                </p>
              )
            )}

            {/* Quiz-taking panel — renders nothing when the module has no active questions */}
            <ModuleQuizPanel
              key={moduleDetail.id}
              moduleId={moduleDetail.id}
              hasAttempts={(attemptsByModule[moduleDetail.id] ?? []).length > 0}
              onSubmitted={handleQuizSubmitted}
            />

            {/* Mark complete — ONLY for quiz-less modules. Modules with an
                active quiz record completion through quiz submission. */}
            {!moduleDetail.has_questions && !moduleDetail.completed_at && (
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={handleMarkComplete}
                  disabled={markingComplete}
                  className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                  data-testid="module-mark-complete"
                >
                  {markingComplete
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle2 className="w-4 h-4" />}
                  Mark as complete
                </button>
                <p className="text-xs text-muted-foreground mt-2">
                  This module has no quiz — mark it complete once you have watched or read the content.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalTraining;
