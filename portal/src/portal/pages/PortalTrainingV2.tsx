/**
 * PortalTrainingV2 — the redesigned teacher-training page (bd-60148).
 *
 * HIDDEN ROUTE. Served at /portal/training/v2 with NO navigation entry: the
 * operator types the URL to review it. /portal/training keeps serving the
 * original page, untouched, until the rollout call is made — so rolling back
 * is "point the nav at the old path", not a revert.
 *
 * WHAT IS DIFFERENT (and why, because none of it is decoration):
 *
 *  1. VENDOR CARDS carry a mark, a progress bar and the quiz average. The old
 *     strip was four text boxes, so "how far am I with Beacon House" needed
 *     arithmetic the teacher had to do herself.
 *
 *  2. THE LEVEL RAIL REPLACES THE LEVEL DROPDOWN. The old Select hid state
 *     inside option labels as emoji (🔒 / 🏆 / 📖), which is unreadable while
 *     collapsed — the one moment a picker is normally read. The rail shows
 *     every level's state at once without opening anything.
 *
 *     The rail READS THE VENDOR'S SHAPE rather than assuming a ladder:
 *       chain     → numbered levels, locks, "pass L2 to unlock" (NIETE, I-SAPS)
 *       parallel  → unnumbered subject tiles, no locks (Beacon House: its
 *                   "levels" are English/Maths/Science/CS, all open at once)
 *     Rendering parallel subjects as a locked ladder is a lie about what the
 *     teacher may do next, and the old dropdown told it to every Beacon House
 *     teacher. `level_unlock_logic` is the flag; `unlock_logic` on the level is
 *     kept for the numbering decision the old page already made.
 *
 *  3. COURSE LIST AND MODULE LIST ARE BOTH ALWAYS VISIBLE, side by side,
 *     instead of two collapsed Selects. Picking a module is one click on
 *     something already on screen.
 *
 *  4. A SINGLE-COURSE LEVEL AUTO-SELECTS ITS COURSE. Oxbridge is one level,
 *     one course, seven modules — the old page made a teacher answer two
 *     questions that had exactly one possible answer each.
 *
 *  5. MODULE VIEW gains "Module N of M", prev/next within the course, and an
 *     "up next" card. The module list is already in memory, so this is
 *     arithmetic, not a request.
 *
 * WHAT IS DELIBERATELY IDENTICAL: every endpoint, every state machine, and
 * every child component (ModuleQuizPanel, LevelExamCard, CapstoneResultCard,
 * CertificatesPanel, BandPicker). This is a re-dress of the same data — no new
 * API, no new column. The three load-failure outcomes stay distinct and stay
 * on screen rather than in a toast (bd-44003), and `levelsLoaded` still
 * separates "nothing assigned" from "could not ask" (bd-43487).
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import DOMPurify from 'dompurify';
import {
  GraduationCap, CheckCircle2, Circle, Loader2, Lock, Award, ClipboardCheck,
  Building2, FileText, ChevronLeft, ChevronRight, Clock, PlayCircle,
} from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ModuleQuizPanel, { type SubmittedAttempt } from '../components/ModuleQuizPanel';
import LevelExamCard from '../components/LevelExamCard';
import CapstoneResultCard from '../components/CapstoneResultCard';
import CertificatesPanel from '../components/CertificatesPanel';
import BandPicker from '../components/BandPicker';
import { classifyTrainingLoadError, EMPTY_MODULES_MESSAGE } from '../lib/trainingLoadError';
import { Button } from '@/components/ui/button';
import ModuleExamPanel, { type ExamGate } from '../components/ModuleExamPanel';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';
import niteLogo from '@/assets/vendors/niete.png';
import beaconhouseLogo from '@/assets/vendors/beaconhouse.png';
import isapsLogo from '@/assets/vendors/isaps.png';
import oxbridgeLogo from '@/assets/vendors/oxbridge.png';

/**
 * Vendor identity — the real logo plus the accent the card is tinted with.
 *
 * Bundled rather than served from R2 or a `training_vendors.logo_url`: there
 * are four rows, the files change roughly never, and Vite fingerprints them
 * into the build so they are cached forever with no request of ours. A DB
 * column earns its place when a partner needs to change its own logo without
 * a deploy; until then it is a column, a migration and an upload to maintain
 * for four constants.
 *
 * Every logo here is dark-on-light artwork, so the tile behind it is WHITE in
 * all four cases. Tinting that tile would muddy three of the four marks — the
 * colour belongs to the card's frame and header, not behind the logo.
 *
 * `tint` is the provider's own brand colour, used only as a wash on the card
 * header and its selected ring, so a row of four cards is scannable by colour
 * before a single word is read.
 */
const VENDOR_BRAND: Record<string, { logo: string; tint: string; label: string }> = {
  TALEEMABAD:  { logo: niteLogo,         tint: '#47ba7d', label: 'NIETE' },
  BEACONHOUSE: { logo: beaconhouseLogo,  tint: '#1b3a6b', label: 'Beacon House' },
  ISAPS:       { logo: isapsLogo,        tint: '#42307d', label: 'I-SAPS' },
  OXBRIDGE:    { logo: oxbridgeLogo,     tint: '#24477f', label: 'Oxbridge' },
};

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
type ModuleSummary = { id: string; title: string; order_index: number; duration_seconds: number; has_video: boolean; has_audio: boolean; has_pdf: boolean; has_questions?: boolean; completed_at: string | null };
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

function bestAttempt(attempts: QuizAttempt[]): QuizAttempt | null {
  if (!attempts || attempts.length === 0) return null;
  return attempts.reduce((best, a) => {
    if (!best) return a;
    const bs = best.score ?? -1;
    const as = a.score ?? -1;
    return as >= bs ? a : best;
  }, null as QuizAttempt | null);
}

/** Green ≥80 / amber ≥50 / red below — the page's one score-colour ladder. */
function scoreTone(pct: number): string {
  if (pct >= 80) return 'text-green-700 bg-green-50 border-green-200';
  if (pct >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

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
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${scoreTone(pct)}`}
      data-testid="quiz-score-badge"
      title={attempts.length > 1 ? `Best of ${attempts.length} attempts` : 'Quiz score'}
    >
      {best.score} / {best.max_score}
    </span>
  );
}

/**
 * Vendor cards. The mark is a lettermark placeholder: `training_vendors` has
 * no logo column and the repo carries logo files for only three of the five
 * vendors (certificates), so inventing an <img> here would render a broken
 * image for Beacon House and I-SAPS. When a logo_url lands, swap the <span>
 * for an <img> — the card geometry already allows for it.
 */
function VendorCards({
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
    <section className="mb-8" data-testid="vendor-grouping">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          Your training providers
        </h2>
        {selectedVendor && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs text-muted-foreground underline"
            data-testid="vendor-clear-filter"
          >
            Show all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {vendors.map((v) => {
          const active = selectedVendor === v.vendor_key;
          const pct = v.module_count > 0
            ? Math.round((v.completed_module_count / v.module_count) * 100)
            : 0;
          const brand = VENDOR_BRAND[v.vendor_key];
          const tint = brand?.tint ?? '#333748';
          const initials = v.vendor_name
            .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
          return (
            <button
              key={v.vendor_key}
              type="button"
              onClick={() => onSelect(active ? null : v.vendor_key)}
              data-testid={`vendor-card-${v.vendor_key}`}
              aria-pressed={active}
              className={`relative text-left rounded-2xl border bg-card overflow-hidden transition-all ${
                active
                  ? 'shadow-lg -translate-y-0.5'
                  : 'border-border shadow-sm hover:shadow-md hover:-translate-y-0.5'
              }`}
              // The provider's own colour, only while selected, so the chosen
              // card is unmistakable without repainting the whole row.
              style={active ? { borderColor: tint, boxShadow: `0 0 0 1px ${tint}` } : undefined}
            >
              {/* A thin bar of the provider's colour — the cheapest way to make
                  four cards tell themselves apart at a glance. */}
              <div className="h-2" style={{ backgroundColor: tint }} />

              <div
                className="h-28 flex items-center justify-center px-6"
                // A wash of the same colour, light enough to keep dark-on-light
                // logo artwork legible on top of it.
                style={{ backgroundColor: `${tint}0f` }}
              >
                {brand ? (
                  <img
                    src={brand.logo}
                    alt={v.vendor_name}
                    className="max-h-16 max-w-full w-auto object-contain"
                    loading="lazy"
                  />
                ) : (
                  // A provider we have no artwork for still needs a mark.
                  <span
                    className="w-10 h-10 rounded-lg text-white flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: tint }}
                  >
                    {initials}
                  </span>
                )}
              </div>

              <div className="px-5 pt-4 pb-1">
                <div className="font-semibold text-lg text-foreground truncate">
                  {v.vendor_name}
                </div>
              </div>

              <div className="px-5 pb-5">
                <div className="text-sm text-muted-foreground mb-4">
                  {v.level_count} {v.level_count === 1 ? 'level' : 'levels'} · {v.module_count} modules
                </div>
                <div
                  className="h-2 rounded-full bg-muted overflow-hidden mb-2"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${v.vendor_name} progress`}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${pct}%`, backgroundColor: tint }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {v.completed_module_count > 0
                      ? `${v.completed_module_count} / ${v.module_count}`
                      : 'Not started'}
                  </span>
                  {v.avg_score_pct == null ? (
                    <span className="text-sm text-muted-foreground" data-testid="vendor-avg-score-none">—</span>
                  ) : (
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full border text-sm font-medium ${scoreTone(v.avg_score_pct)}`}
                      data-testid="vendor-avg-score-badge"
                    >
                      {v.avg_score_pct}% avg
                    </span>
                  )}
                </div>
              </div>

              {active && (
                <span
                  className="absolute top-3.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: tint }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The level rail — the thing that replaces the Level dropdown.
 *
 * `laddered` decides the whole treatment. It is derived from the LEVELS
 * themselves (`unlock_logic`), which is what the old page already used to
 * decide whether to print "Level N ·" in front of a name, so the two surfaces
 * cannot disagree about which vendors are ladders.
 */
function LevelRail({
  levels,
  selectedLevel,
  onSelect,
  tint,
}: {
  levels: Level[];
  selectedLevel: string;
  onSelect: (id: string) => void;
  /** The chosen provider's colour, so the rail reads as part of that card. */
  tint: string | null;
}) {
  if (levels.length === 0) return null;

  // A single-level vendor (Oxbridge, I-SAPS) has no ladder to show. Rendering
  // one card labelled "Level 1 of 1" is noise between the teacher and her
  // courses, so the rail collapses to nothing and the course list carries on.
  if (levels.length === 1) return null;

  const laddered = (levels[0].unlock_logic || 'chain') === 'chain';
  // Falls back to the NIETE green when a provider has no colour of its own.
  const bar = tint ?? '#47ba7d';

  return (
    <section className="mb-8" data-testid="level-rail">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-foreground">
          {laddered ? 'Your levels' : 'Choose a subject'}
        </h2>
        <span className="text-sm text-muted-foreground">
          {laddered ? 'Each level unlocks the next' : 'These are independent — take them in any order'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {levels.map((l) => {
          const active = String(l.id) === selectedLevel;
          const locked = l.state === 'locked';
          const certified = l.state === 'certified';
          const pct = l.module_count > 0
            ? Math.round((l.completed_count / l.module_count) * 100)
            : 0;

          return (
            <button
              key={l.id}
              type="button"
              disabled={locked}
              onClick={() => onSelect(String(l.id))}
              data-testid={`level-card-${l.id}`}
              aria-pressed={active}
              className={`text-left rounded-xl border p-5 transition-all ${
                locked
                  ? 'border-dashed border-border bg-muted/40 cursor-not-allowed'
                  : active
                    ? 'bg-card shadow-lg -translate-y-0.5'
                    : certified
                      ? 'border-green-200 bg-green-50/60 hover:shadow-md hover:-translate-y-0.5'
                      : 'border-border bg-card shadow-sm hover:shadow-md hover:-translate-y-0.5'
              }`}
              style={active && bar ? { borderColor: bar, boxShadow: `0 0 0 1px ${bar}` } : undefined}
            >
              <div className="flex items-center justify-between mb-2">
                {laddered ? (
                  <span className={`text-xs font-bold tracking-wider ${locked ? 'text-muted-foreground' : 'text-foreground'}`}>
                    LEVEL {l.order_index + 1}
                  </span>
                ) : (
                  <span className="text-xs font-bold tracking-wider text-muted-foreground">
                    SUBJECT
                  </span>
                )}
                {locked && <Lock className="w-4 h-4 text-muted-foreground" />}
                {certified && <Award className="w-4 h-4 text-green-700" />}
                {!locked && !certified && l.state === 'ready_for_quiz' && (
                  <ClipboardCheck className="w-4 h-4 text-amber-700" />
                )}
              </div>

              <div className={`text-base font-semibold mb-3 ${locked ? 'text-muted-foreground' : 'text-foreground'}`}>
                {l.name}
              </div>

              <div
                className="h-2 rounded-full bg-muted overflow-hidden mb-2.5"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${l.name} progress`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, backgroundColor: certified ? '#15803d' : bar }}
                />
              </div>

              <div className={`text-sm font-medium ${
                locked ? 'text-muted-foreground'
                : certified ? 'text-green-700'
                : 'text-foreground'
              }`}>
                {locked
                  // The gate is the PREVIOUS level's exam. previous_level_order
                  // is 0-based like order_index, so +1 to speak the teacher's
                  // numbering — the same arithmetic the old dropdown did.
                  ? `Pass Level ${(l.previous_level_order ?? 0) + 1} to unlock`
                  : certified
                    ? `Certified · ${l.completed_count}/${l.module_count}`
                    : l.state === 'ready_for_quiz'
                      ? 'Ready for the exam'
                      : `${l.completed_count} / ${l.module_count} modules`}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const PortalTrainingV2 = () => {
  const { toast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  // bd-60149 — the module's own summative exam, delivered with its units.
  const [moduleExam, setModuleExam] = useState<ExamGate | null>(null);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; locked: boolean } | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>('');

  const [levelsLoaded, setLevelsLoaded] = useState(false);
  const [editingBands, setEditingBands] = useState(false);

  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingLevels, setLoadingLevels] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [attemptsByModule, setAttemptsByModule] = useState<Record<string, QuizAttempt[] | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/training/vendors');
        setVendors(data.vendors || []);
      } catch {
        // Silent — the vendor strip is an enhancement; the rail below still works.
      } finally { setLoadingVendors(false); }
    })();
    (async () => {
      try {
        const { data } = await api.get('/training/levels');
        setLevels(data.levels || []);
        setLevelsLoaded(true);
      } catch {
        toast({ title: 'Could not load training levels', variant: 'destructive' });
      } finally { setLoadingLevels(false); }
    })();
  }, [toast]);

  const selectedLevelObj = useMemo(
    () => levels.find(l => String(l.id) === selectedLevel) ?? null,
    [levels, selectedLevel]
  );

  const refreshLevels = useCallback(async () => {
    try {
      const { data } = await api.get('/training/levels');
      setLevels(data.levels || []);
    } catch { /* silent — the next mount refetches anyway */ }
  }, []);

  // NO VENDOR, NO LEVELS. v1 showed every provider's levels at once when
  // nothing was picked, and v2 inherited it — which a dropdown survived and a
  // rail does not: ten levels from four providers in one flat grid, two of
  // them both labelled "LEVEL 1", nothing saying which belongs to whom.
  // Choosing a provider is the first step, so the rail waits for it.
  const visibleLevels = useMemo(() => {
    if (!selectedVendor) return [];
    return levels.filter(l => l.vendor_key === selectedVendor);
  }, [levels, selectedVendor]);

  useEffect(() => {
    if (!selectedLevel) return;
    if (!visibleLevels.some(l => String(l.id) === selectedLevel)) {
      setSelectedLevel('');
      setSelectedCourse('');
      setSelectedModule('');
      setCourses([]);
      setModules([]); setModuleExam(null);
      setModuleDetail(null);
    }
  }, [visibleLevels, selectedLevel]);

  // One provider is not a choice. Gating the rail on a vendor (above) would
  // otherwise make a single-provider teacher click her only card before
  // seeing anything — so pick it for her. Derived from the LEVELS rather than
  // the vendor roll-up, because the roll-up is an enhancement that is allowed
  // to fail silently, and a page that shows nothing when it does is worse
  // than one that never had it.
  useEffect(() => {
    if (selectedVendor) return;
    const keys = Array.from(
      new Set(levels.map(l => l.vendor_key).filter((k): k is string => !!k)),
    );
    if (keys.length === 1) setSelectedVendor(keys[0]);
  }, [levels, selectedVendor]);

  // A single-level vendor has nothing to choose: select it so the teacher
  // lands on the courses. The rail renders nothing in this case, so without
  // this the page would show an empty gap and no course list at all.
  useEffect(() => {
    if (selectedLevel) return;
    if (visibleLevels.length !== 1) return;
    if (visibleLevels[0].state === 'locked') return;
    setSelectedLevel(String(visibleLevels[0].id));
  }, [visibleLevels, selectedLevel]);

  const handleLevelChange = useCallback((val: string) => {
    const lvl = levels.find(l => String(l.id) === val);
    if (lvl && lvl.state === 'locked') {
      toast({
        title: 'Level locked',
        description: `Pass the Level ${(lvl.previous_level_order ?? 0) + 1} exam first.`,
      });
      return;
    }
    setSelectedLevel(val);
  }, [levels, toast]);

  useEffect(() => {
    setCourses([]); setModules([]); setModuleDetail(null);
    setSelectedCourse(''); setSelectedModule('');
    setLoadError(null);
    if (!selectedLevel) return;
    (async () => {
      setLoadingCourses(true);
      setLoadError(null);
      try {
        const { data } = await api.get('/training/courses', { params: { level_id: selectedLevel } });
        setCourses(data.courses || []);
      } catch (err: unknown) {
        const e = classifyTrainingLoadError(err);
        setLoadError({ message: e.message, locked: e.kind === 'locked' });
        toast({ title: e.message, variant: 'destructive' });
      } finally { setLoadingCourses(false); }
    })();
  }, [selectedLevel, toast]);

  // A level with exactly one course (Oxbridge) asks a question with one
  // possible answer. Answer it for her.
  useEffect(() => {
    if (selectedCourse) return;
    if (courses.length !== 1) return;
    setSelectedCourse(courses[0].id);
  }, [courses, selectedCourse]);

  useEffect(() => {
    setModules([]); setModuleDetail(null);
    setSelectedModule('');
    setAttemptsByModule({});
    setLoadError(null);
    if (!selectedCourse) return;
    (async () => {
      setLoadingModules(true);
      try {
        const { data } = await api.get('/training/modules', { params: { course_id: selectedCourse } });
        const list: ModuleSummary[] = data.modules || [];
        setModules(list);
        setModuleExam(data.exam || null);
        if (list.length > 0) {
          setAttemptsByModule(Object.fromEntries(list.map(m => [m.id, null])));
          list.forEach(m => {
            api.get(`/training/module/${m.id}/attempts`)
              .then(({ data: d }) => {
                setAttemptsByModule(prev => ({ ...prev, [m.id]: d.attempts || [] }));
              })
              .catch(() => {
                setAttemptsByModule(prev => ({ ...prev, [m.id]: [] }));
              });
          });
        }
      } catch (err: unknown) {
        const e = classifyTrainingLoadError(err);
        setLoadError({ message: e.message, locked: e.kind === 'locked' });
        toast({ title: e.message, variant: 'destructive' });
      } finally { setLoadingModules(false); }
    })();
  }, [selectedCourse, toast]);

  const handleQuizSubmitted = useCallback((attempt: SubmittedAttempt) => {
    const moduleId = selectedModule;
    if (!moduleId) return;
    api.get(`/training/module/${moduleId}/attempts`)
      .then(({ data }) => {
        setAttemptsByModule(prev => ({ ...prev, [moduleId]: data.attempts || [] }));
      })
      .catch(() => {
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

  useEffect(() => {
    setModuleDetail(null);
    if (!selectedModule) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const { data } = await api.get(`/training/module/${selectedModule}`);
        setModuleDetail(data.module);
      } catch (err: unknown) {
        const e = classifyTrainingLoadError(err);
        setLoadError({ message: e.message, locked: e.kind === 'locked' });
        toast({ title: e.message, variant: 'destructive' });
      } finally { setLoadingDetail(false); }
    })();
  }, [selectedModule, toast]);

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

  // Position of the open module within its course — drives "Module N of M",
  // the prev/next arrows and the "up next" card. Pure arithmetic over state we
  // already hold, so moving between modules costs no extra request beyond the
  // detail fetch that any selection triggers.
  const moduleIndex = useMemo(
    () => (selectedModule ? modules.findIndex(m => m.id === selectedModule) : -1),
    [modules, selectedModule],
  );
  const prevModule = moduleIndex > 0 ? modules[moduleIndex - 1] : null;
  const nextModule =
    moduleIndex >= 0 && moduleIndex < modules.length - 1 ? modules[moduleIndex + 1] : null;

  const selectedCourseObj = useMemo(
    () => courses.find(c => c.id === selectedCourse) ?? null,
    [courses, selectedCourse],
  );

  if (loadingLevels || loadingVendors) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  const noAssignment = levelsLoaded && levels.length === 0;


  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl" data-testid="training-v2-root">

        {/* The NIETE navy→green gradient (--gradient-hero). The page used to
            open on flat white, which read as unfinished next to the rest of
            the portal. */}
        <div
          className="rounded-2xl p-6 sm:p-7 mb-7 text-white"
          style={{ background: 'linear-gradient(135deg, hsl(229 17% 24%) 0%, hsl(146 44% 51%) 100%)' }}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-light mb-1">Training</h1>
              <p className="text-sm text-white/75">
                Your assigned professional development.
              </p>
            </div>
            <CertificatesPanel />
          </div>
        </div>

        {/* No assignment — the recovery path, not a dead end (bd-43487). */}
        {noAssignment && (
          <div className="rounded-xl border bg-card p-6 shadow-sm mb-6" data-testid="training-no-assignment">
            <div className="flex items-center gap-2 font-medium mb-1">
              <GraduationCap className="w-5 h-5 text-muted-foreground" />
              No training assigned yet
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Tell us which grades you teach and we'll set up your training.
            </p>
            <BandPicker onSaved={refreshLevels} />
          </div>
        )}

        {/* bd-44003 — why the page is empty, kept ON SCREEN, not in a toast. */}
        {loadError && (
          <div
            className={`rounded-xl border p-4 mb-6 text-sm ${
              loadError.locked
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
            data-testid="training-load-error"
          >
            {loadError.locked && <Lock className="w-4 h-4 inline mr-1.5 -mt-0.5" />}
            {loadError.message}
          </div>
        )}

        {!noAssignment && (
          <>
            <VendorCards
              vendors={vendors}
              selectedVendor={selectedVendor}
              onSelect={setSelectedVendor}
            />

            {/* The gated state says what to do next, rather than ending the
                page in white space. */}
            {!selectedVendor && levels.length > 0 && (
              <div
                className="rounded-2xl border border-dashed p-8 text-center mb-8"
                data-testid="vendor-prompt"
              >
                <Building2 className="w-7 h-7 mx-auto mb-2.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground mb-1">
                  Choose a training provider to begin
                </p>
                <p className="text-xs text-muted-foreground">
                  Your levels, courses and modules appear here once you pick one above.
                </p>
              </div>
            )}

            <LevelRail
              levels={visibleLevels}
              selectedLevel={selectedLevel}
              onSelect={handleLevelChange}
              tint={selectedVendor ? (VENDOR_BRAND[selectedVendor]?.tint ?? null) : null}
            />

            {/* Written-capstone history for non-chain levels (bd-2233). */}
            {selectedLevelObj && (selectedLevelObj.unlock_logic || 'chain') !== 'chain' && (
              <CapstoneResultCard
                key={`cap-${selectedLevelObj.id}`}
                levelId={selectedLevelObj.id}
                levelName={selectedLevelObj.name}
              />
            )}

            {/* The level exam belongs to the LEVEL, so it sits above the
                course/module lists rather than below the open module. */}
            {selectedLevelObj && selectedLevelObj.state !== 'locked' && (
              <div className="mb-8">
                <LevelExamCard
                  key={selectedLevelObj.id}
                  levelId={selectedLevelObj.id}
                  levelName={selectedLevelObj.name}
                  levelOrderIndex={selectedLevelObj.order_index}
                  onCertified={refreshLevels}
                />
              </div>
            )}

            {/* Courses + modules, both visible at once. */}
            {selectedLevel && (
              <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 mb-8">
                <div className="rounded-2xl border bg-card p-2 shadow-sm" data-testid="course-list">
                  <div className="px-3.5 pt-3 pb-2 text-xs font-bold tracking-wider text-muted-foreground">
                    COURSES
                  </div>
                  {loadingCourses && (
                    <div className="p-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                  )}
                  {!loadingCourses && courses.length === 0 && (
                    <p className="px-3 pb-3 text-sm text-muted-foreground">No courses in this level.</p>
                  )}
                  {courses.map(c => {
                    const active = c.id === selectedCourse;
                    const done = c.module_count > 0 && c.completed_count >= c.module_count;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCourse(c.id)}
                        data-testid={`course-item-${c.id}`}
                        aria-pressed={active}
                        className={`w-full text-left rounded-lg px-3 py-2.5 mb-0.5 transition-colors ${
                          active ? 'bg-accent/10' : 'hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[15px] ${active ? 'font-semibold text-accent-foreground' : 'text-foreground'}`}>
                            {c.title}
                          </span>
                          <span className={`text-sm shrink-0 ${done ? 'text-green-700' : 'text-muted-foreground'}`}>
                            {c.completed_count}/{c.module_count}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                </div>

                <div className="rounded-2xl border bg-card p-2 shadow-sm" data-testid="module-list">
                  <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
                    <span className="text-xs font-bold tracking-wider text-muted-foreground truncate">
                      {selectedCourseObj ? selectedCourseObj.title.toUpperCase() : 'MODULES'}
                    </span>
                    {selectedCourseObj && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {selectedCourseObj.completed_count} of {selectedCourseObj.module_count} complete
                      </span>
                    )}
                  </div>

                  {loadingModules && (
                    <div className="p-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                  )}

                  {!loadingModules && !selectedCourse && (
                    <p className="px-3.5 pb-3 text-sm text-muted-foreground">
                      Pick a course to see its modules.
                    </p>
                  )}

                  {/* The third distinct outcome: a real answer that is empty. */}
                  {!loadingModules && selectedCourse && modules.length === 0 && (
                    <p className="px-3.5 pb-3 text-sm text-muted-foreground" data-testid="training-empty-modules">
                      {EMPTY_MODULES_MESSAGE}
                    </p>
                  )}

                  {modules.map(m => {
                    const active = m.id === selectedModule;
                    const attempts = attemptsByModule[m.id];
                    const loading = m.id in attemptsByModule && attempts === null;
                    // The unit's own formative assessment is a separate row —
                    // but only when the unit actually has one.
                    const scored = (attempts || []).some(a => a.completed_at);
                    return (
                    <Fragment key={m.id}>
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedModule(m.id)}
                        data-testid={`module-item-${m.id}`}
                        aria-pressed={active}
                        className={`w-full text-left rounded-lg px-3.5 py-2.5 mb-0.5 flex items-center gap-3 transition-colors ${
                          active ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-muted/50'
                        }`}
                      >
                        {m.completed_at
                          ? <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                          : <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <span className={`flex-1 text-[15px] truncate ${active ? 'font-semibold' : ''} text-foreground`}>
                          {m.title}
                        </span>
                        {m.duration_seconds > 0 && (
                          <span className="text-sm text-muted-foreground shrink-0">
                            {formatDuration(m.duration_seconds)}
                          </span>
                        )}
                        <QuizScoreBadge
                          attempts={attempts ?? null}
                          moduleCompleted={!!m.completed_at}
                          loading={loading}
                        />
                      </button>
                      {m.has_questions && (
                        <button
                          type="button"
                          onClick={() => setSelectedModule(m.id)}
                          data-testid={`module-assessment-${m.id}`}
                          className={`w-full text-left rounded-lg pl-9 pr-3.5 py-2 mb-0.5 flex items-center gap-3 transition-colors ${
                            active ? 'bg-accent/5' : 'hover:bg-muted/50'
                          }`}
                        >
                          {scored
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                            : <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          <span className="flex-1 text-sm truncate text-muted-foreground">
                            {m.title} — Assessment
                          </span>
                        </button>
                      )}
                    </Fragment>
                    );
                  })}
                  {/* bd-60149 — the I-SAPS reading of this list.
                      A unit and its own formative assessment are two separate
                      things a teacher does in order, so they are two rows:
                      "Unit 301" then "Unit 301 — Assessment". The assessment
                      row is CONDITIONAL — 2 of the level's 54 units carry no
                      questions at all, and a row for them would promise work
                      that does not exist. Selecting either row opens the same
                      unit; the detail card already holds the quiz. */}

                  {/* bd-60149 — the module's summative exam, as the row AFTER
                      its units, which is where a teacher looks for it. It was
                      first built inside a unit's detail card, so walking from
                      the last unit of one module to the first of the next
                      never showed it at all. Renders nothing unless this
                      course has an exam. */}
                  {selectedCourse && moduleExam && (
                    <ModuleExamPanel
                      key={`exam-${selectedCourse}`}
                      courseId={String(selectedCourse)}
                      exam={moduleExam}
                      asListRow
                      onPassed={() => {
                        if (!selectedCourse) return;
                        api.get('/training/modules', { params: { course_id: selectedCourse } })
                          .then(({ data }) => {
                            setModules(data.modules || []);
                            setModuleExam(data.exam || null);
                          })
                          .catch(() => { /* the pass is recorded server-side either way */ });
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ── The open module ──────────────────────────────────────── */}
            {loadingDetail && (
              <div className="rounded-2xl border bg-card p-6 shadow-sm">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {moduleDetail && !loadingDetail && (
              <div className="rounded-2xl border bg-card shadow-sm overflow-hidden" data-testid="module-detail">
                <div className="p-6 border-b">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-xl font-medium text-foreground mb-1.5">{moduleDetail.title}</h2>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        {moduleDetail.duration_seconds > 0 && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {formatDuration(moduleDetail.duration_seconds)}
                          </span>
                        )}
                        {moduleDetail.completed_at ? (
                          <span className="flex items-center gap-1.5 text-green-600">
                            <CheckCircle2 className="w-4 h-4" /> Completed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Circle className="w-4 h-4" /> Not yet
                          </span>
                        )}
                        {moduleIndex >= 0 && (
                          <span
                            className="inline-flex px-2 py-0.5 rounded-full bg-muted text-xs font-medium"
                            data-testid="module-position"
                          >
                            Module {moduleIndex + 1} of {modules.length}
                          </span>
                        )}
                        <QuizScoreBadge
                          attempts={attemptsByModule[moduleDetail.id] ?? null}
                          moduleCompleted={!!moduleDetail.completed_at}
                          loading={moduleDetail.id in attemptsByModule && attemptsByModule[moduleDetail.id] === null}
                        />
                      </div>
                    </div>

                    {/* Prev/next stay within the course: `modules` only ever
                        holds one course's list, so promising more would be a
                        lie the state cannot keep. */}
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={!prevModule}
                        onClick={() => prevModule && setSelectedModule(prevModule.id)}
                        aria-label="Previous module"
                        data-testid="module-prev"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={!nextModule}
                        onClick={() => nextModule && setSelectedModule(nextModule.id)}
                        aria-label="Next module"
                        data-testid="module-next"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  {moduleDetail.video_url && (
                    <div className="rounded-lg overflow-hidden bg-black">
                      <video
                        controls
                        className="w-full max-h-[560px] mx-auto"
                        preload="metadata"
                        src={moduleDetail.video_url}
                      >
                        Your browser doesn't support inline video.{' '}
                        <a href={moduleDetail.video_url} target="_blank" rel="noopener">Open the video in a new tab</a>.
                      </video>
                    </div>
                  )}

                  {moduleDetail.audio_url && (
                    <div className="rounded-lg bg-muted p-3">
                      <audio controls className="w-full" preload="metadata" src={moduleDetail.audio_url}>
                        Your browser doesn't support inline audio.
                      </audio>
                    </div>
                  )}

                  {moduleDetail.pdf_url && (
                    <div
                      className="rounded-lg border bg-muted/40 p-4 flex items-center justify-between gap-4"
                      data-testid="module-pdf-block"
                    >
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

                  {moduleDetail.content_html && moduleDetail.content_html.trim().length > 0 ? (
                    <div
                      className="prose prose-sm max-w-none"
                      // eslint-disable-next-line react/no-danger — DOMPurify sanitises before render
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(moduleDetail.content_html) }}
                    />
                  ) : (
                    !moduleDetail.video_url && !moduleDetail.audio_url && !moduleDetail.pdf_url && (
                      <p className="text-sm text-muted-foreground">
                        This module has no readable content yet. It's likely a checkpoint or reflection module.
                      </p>
                    )
                  )}

                  {!moduleDetail.has_questions && !moduleDetail.completed_at && (
                    <div className="pt-2">
                      <Button
                        onClick={handleMarkComplete}
                        disabled={markingComplete}
                        data-testid="module-mark-complete"
                      >
                        {markingComplete
                          ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          : <CheckCircle2 className="w-4 h-4 mr-2" />}
                        Mark as complete
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2">
                        This module has no quiz — mark it complete once you have watched or read the content.
                      </p>
                    </div>
                  )}
                </div>

                {/* The quiz is a separate act from reading, so it gets its own
                    tinted panel rather than continuing the content column. */}
                <div className="bg-muted/30 px-6 pb-6">
                  <ModuleQuizPanel
                    key={moduleDetail.id}
                    moduleId={moduleDetail.id}
                    hasAttempts={(attemptsByModule[moduleDetail.id] ?? []).length > 0}
                    hasQuestions={moduleDetail.has_questions}
                    onSubmitted={handleQuizSubmitted}
                  />
                </div>

                {nextModule && (
                  <div className="border-t px-6 py-4 flex items-center justify-between gap-4" data-testid="module-up-next">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold tracking-wider text-muted-foreground mb-0.5">
                        UP NEXT
                      </div>
                      <div className="text-sm font-medium text-foreground truncate">
                        {nextModule.title}
                        {nextModule.duration_seconds > 0 && (
                          <span className="text-muted-foreground font-normal">
                            {' · '}{formatDuration(nextModule.duration_seconds)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" onClick={() => setSelectedModule(nextModule.id)}>
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Continue
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Band editing stays available once training IS assigned. */}
            {levels.length > 0 && (
              <div className="mt-8">
                {editingBands ? (
                  <BandPicker onSaved={() => { setEditingBands(false); refreshLevels(); }} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingBands(true)}
                    className="text-xs text-muted-foreground underline"
                    data-testid="training-edit-bands"
                  >
                    Change the grades you teach
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalTrainingV2;
