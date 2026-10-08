/**
 * PortalTrainingV2 — the redesigned teacher-training page (bd-60148).
 *
 * THE training page (bd-60160). Served at /portal/training — the path the nav
 * has always pointed at — and still at /portal/training/v2, the review URL.
 *
 * Was, until bd-60160: HIDDEN ROUTE. Served at /portal/training/v2 with NO navigation entry: the
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

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import DOMPurify from 'dompurify';
import {
  GraduationCap, Check, CheckCircle2, Circle, Loader2, Lock, Award, ClipboardCheck,
  Building2, FileText, ChevronLeft, ChevronRight, Clock, PlayCircle,
} from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { SkeletonList, SkeletonLine } from '../components/Skeleton';
import ModuleQuizPanel, { type SubmittedAttempt } from '../components/ModuleQuizPanel';
import { completesModule } from '../lib/moduleQuiz';
import LevelExamCard from '../components/LevelExamCard';
import LevelCertificateRow from '../components/LevelCertificateRow';
import CapstoneResultCard from '../components/CapstoneResultCard';
import CertificatesPanel from '../components/CertificatesPanel';
import BandPicker from '../components/BandPicker';
import { classifyTrainingLoadError, EMPTY_MODULES_MESSAGE } from '../lib/trainingLoadError';
import { Button } from '@/components/ui/button';
import ModuleExamPanel, { type ExamGate } from '../components/ModuleExamPanel';
import ModuleReadings, { type ModuleReadingList } from '../components/ModuleReadings';
import { unitRowState, type UnitLock } from '../lib/unitLock';
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
  certificate_count: number;
  avg_score_pct: number | null;
};

/**
 * bd-60152 — vendors that assess PER MODULE and have no level exam at all.
 *
 * The level-exam card rendered "🔒 Level exam — locked. Unlocks when all
 * courses in this level are complete (1/9 courses started)" on I-SAPS, which
 * has no level exam: it is assessed module by module, and the certificate
 * comes from finishing all nine. Announcing the absence of an exam reads as
 * something missing rather than as by design, so the card is simply not shown.
 *
 * A set rather than an === so the next per-module vendor is one word, and
 * hardcoded rather than derived because the data model cannot yet say "this
 * level has no exam" — the real fix is bd-60150, which stops a per-module quiz
 * being reported as the level's.
 */
const LEVEL_EXAMLESS_VENDORS = new Set(['ISAPS']);

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
/**
 * bd-66wui — a course or module id, in whichever shape it arrived.
 *
 * The API sends training_courses.id and training_modules.id as JSON NUMBERS
 * (bigint through PostgREST); the URL, and the selection state set from it,
 * always holds a STRING. These types said `string` for both, so `m.id ===
 * selectedModule` type-checked and was false for every row in production:
 * no "Module N of M", no UP NEXT, a pass that never ticked the header, and a
 * course page whose crumb read "Course". Compare ids only through sameId.
 */
type Id = string | number;
const sameId = (a: Id | null | undefined, b: Id | null | undefined): boolean =>
  a != null && b != null && String(a) === String(b);

type Course = { id: Id; title: string; course_type: string; order_index: number; module_count: number; completed_count: number };
type ModuleSummary = { id: Id; title: string; order_index: number; duration_seconds: number; has_video: boolean; has_audio: boolean; has_pdf: boolean; has_questions?: boolean; completed_at: string | null; lock?: UnitLock };
type ModuleDetail = {
  id: Id; title: string; content_html: string;
  video_url: string | null; audio_url: string | null;
  pdf_url: string | null; has_questions: boolean;
  duration_seconds: number; order_index: number; completed_at: string | null;
  course: { id: Id; title: string } | null;
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
  onOpen,
}: {
  vendors: Vendor[];
  /** bd-klecr — a card opens that provider's OWN page; nothing opens under the cards. */
  onOpen: (key: string) => void;
}) {
  if (vendors.length === 0) return null;
  return (
    <section className="mb-8" data-testid="vendor-grouping">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          Your training providers
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {vendors.map((v) => {
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
              onClick={() => onOpen(v.vendor_key)}
              data-testid={`vendor-card-${v.vendor_key}`}
              className="relative text-left rounded-2xl border border-border bg-card overflow-hidden transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:[border-color:var(--tint)] focus-visible:[border-color:var(--tint)]"
              // The provider's own colour on hover, so the card reads as
              // something that opens rather than a static tile.
              style={{ '--tint': tint } as React.CSSProperties}
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
                  {/* bd-60152 — the card leads with what a teacher has EARNED.
                      The figure beside it is the bar in words. */}
                  <span className="text-sm font-semibold text-foreground" data-testid="vendor-certificate-count">
                    {v.certificate_count === 1
                      ? '1 Certificate'
                      : `${v.certificate_count || 0} Certificates`}
                  </span>
                  <span className="text-sm text-muted-foreground" data-testid="vendor-progress-pct">
                    {pct}%
                  </span>
                </div>
              </div>
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

  // bd-klecr — a single-level vendor (Oxbridge, I-SAPS) shows its one card
  // too. The level is now its own page, so collapsing the rail would leave the
  // provider page empty with nothing to click (operator: every page always
  // shows).

  const laddered = (levels[0].unlock_logic || 'chain') === 'chain';
  // Operator, 2026-10-02 (design option A): a provider with ONE level (I-SAPS,
  // Oxbridge) gets the breadcrumb and its card, nothing else. Both share
  // Beacon House's any-order rule, so they were told to "choose a subject"
  // from a list of one, which "these are independent" then described. A
  // ladder or a set of subjects needs a heading; a single card does not.
  const single = levels.length === 1;
  // Falls back to the NIETE green when a provider has no colour of its own.
  const bar = tint ?? '#47ba7d';

  return (
    <section className="mb-8" data-testid="level-rail">
      {!single && (
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">
            {laddered ? 'Your levels' : 'Choose a subject'}
          </h2>
          <span className="text-sm text-muted-foreground">
            {laddered ? 'Each level unlocks the next' : 'These are independent — take them in any order'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {levels.map((l) => {
          const active = String(l.id) === selectedLevel;
          const locked = l.state === 'locked';
          const certified = l.state === 'certified';
          // Operator, 2026-10-02: a level card counts COURSES — they are what a
          // level holds and what its own page lists. "0 / 55 modules" on
          // Beacon House English was counting the layer two pages down. The
          // bar follows the same count, so the two never disagree.
          const coursesTotal = l.courses_total || 0;
          const coursesDone = Math.min(l.courses_completed || 0, coursesTotal);
          const pct = coursesTotal > 0
            ? Math.round((coursesDone / coursesTotal) * 100)
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
              {/* The label row. On a single-level provider there is no
                  "LEVEL N" or "SUBJECT" to say, so the row only appears when
                  a status icon has something to show. */}
              {(!single || locked || certified || l.state === 'ready_for_quiz') && (
              <div className={`flex items-center mb-2 ${single ? 'justify-end' : 'justify-between'}`}>
                {single ? null : laddered ? (
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
              )}

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
                    ? `Certified · ${coursesDone}/${coursesTotal} courses`
                    : l.state === 'ready_for_quiz'
                      ? 'Ready for the exam'
                      : `${coursesDone} / ${coursesTotal} ${coursesTotal === 1 ? 'course' : 'courses'}`}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The trail on the provider, level, course and certificates pages. */
function TrainingBreadcrumb({
  onTraining,
  crumbs,
}: {
  onTraining: () => void;
  /** The last crumb is the page you are on; give it no onClick. */
  crumbs: { label: string; onClick?: () => void; testId?: string }[];
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-2 mb-6 text-sm min-w-0"
      aria-label="Breadcrumb"
      data-testid="training-breadcrumb"
    >
      <button
        type="button"
        onClick={onTraining}
        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        data-testid="breadcrumb-training"
      >
        <ChevronLeft className="w-4 h-4" />
        Training
      </button>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          <span className="text-muted-foreground/50" aria-hidden="true">/</span>
          {c.onClick ? (
            <button
              type="button"
              onClick={c.onClick}
              className="text-muted-foreground hover:text-foreground transition-colors truncate"
              data-testid={c.testId}
            >
              {c.label}
            </button>
          ) : (
            <span className="font-semibold text-foreground truncate" aria-current="page" data-testid={c.testId}>
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
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
  // I-SAPS recommended reading for the open course (null for other vendors).
  const [moduleReadings, setModuleReadings] = useState<ModuleReadingList | null>(null);
  // Bumped when a module exam is passed, so the certificate card re-reads its
  // "N of 9 module exams passed" instead of showing the count from page load.
  const [certTick, setCertTick] = useState(0);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; locked: boolean } | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>('');

  // bd-60152 — a unit has its OWN page and URL.
  //
  // It was a panel under the course/module lists, which meant it could not be
  // linked, reloaded or left with the browser's back button, and a teacher
  // reading a unit still had the whole picker above her. The route parameter
  // is now the source of truth for what is open; selecting a unit navigates,
  // and closing it navigates back.
  const {
    moduleId: routeModuleId,
    courseId: routeExamCourseId,
    vendorKey: routeVendorKey,
    levelId: routeLevelId,
    browseCourseId: routeCourseId,
  } = useParams<{
    moduleId: string; courseId: string;
    vendorKey: string; levelId: string; browseCourseId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  // bd-60160 — the page is served from BOTH /portal/training (canonical, what
  // the nav points at) and /portal/training/v2 (the review URL, kept alive
  // because it has been handed out). Hardcoding /v2 here meant a teacher who
  // arrived at the canonical path was thrown onto /v2 by her first tap, and
  // the breadcrumb then walked her back to a different page from the one she
  // started on. Derive the base from where she actually is.
  const routeBase = location.pathname.startsWith('/portal/training/v2')
    ? '/portal/training/v2'
    : '/portal/training';

  const openUnit = useCallback((id: Id) => {
    navigate(`${routeBase}/unit/${id}`);
  }, [navigate, routeBase]);
  const openExam = useCallback((courseId: string) => {
    navigate(`${routeBase}/exam/${courseId}`);
  }, [navigate, routeBase]);
  /** True when EITHER a unit or an exam has taken over the page. */
  const onSubPage = Boolean(routeModuleId || routeExamCourseId);

  // bd-klecr — one page per step. Which one is open is read from the URL, so
  // Back, reload and a shared link all land on the same step.
  const onCertificatesPage = !onSubPage && /\/certificates\/?$/.test(location.pathname);
  const screenKind: 'home' | 'certificates' | 'provider' | 'level' | 'course' | 'sub' =
    onSubPage ? 'sub'
      : onCertificatesPage ? 'certificates'
        : routeCourseId ? 'course'
          : routeLevelId ? 'level'
            : routeVendorKey ? 'provider'
              : 'home';
  // The URL names the course on the course page, so it owns the selection the
  // same way a unit URL does: the level effect must not clear it.
  const urlOwnsCourse = onSubPage || Boolean(routeCourseId);

  const providerUrl = useCallback(
    (vendorKey: string) => `${routeBase}/provider/${encodeURIComponent(vendorKey)}`,
    [routeBase],
  );
  const levelUrl = useCallback(
    (vendorKey: string, levelId: string | number) => `${providerUrl(vendorKey)}/level/${levelId}`,
    [providerUrl],
  );
  const courseUrl = useCallback(
    (vendorKey: string, levelId: string | number, courseId: Id) =>
      `${levelUrl(vendorKey, levelId)}/course/${encodeURIComponent(String(courseId))}`,
    [levelUrl],
  );

  // Keep the selection in step with the URL, in both directions: a deep link
  // or a back button must open the right unit.
  // bd-60152 — a unit opened by URL restores its own course and level.
  //
  // `modules` is fetched from selectedCourse. On a direct load of
  // /unit/:id nothing had set that, so the list was empty, moduleIndex was -1,
  // and prev/next were both null and disabled — the reported "navigation
  // doesn't work". The detail response already carries course and level, so
  // the page can put itself back together from the URL alone.
  useEffect(() => {
    if (!moduleDetail) return;
    if (moduleDetail.level && !selectedLevel) setSelectedLevel(String(moduleDetail.level.id));
    // String(): the selection is compared with the URL's id, which is a string.
    if (moduleDetail.course && !selectedCourse) setSelectedCourse(String(moduleDetail.course.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleDetail]);

  // bd-60152 — an exam opened by URL selects its course, so the gate and the
  // paper resolve exactly as they do from the list.
  useEffect(() => {
    if (routeExamCourseId && routeExamCourseId !== selectedCourse) {
      setSelectedCourse(routeExamCourseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeExamCourseId]);

  useEffect(() => {
    if (routeModuleId && routeModuleId !== selectedModule) setSelectedModule(routeModuleId);
    if (!routeModuleId && selectedModule) setSelectedModule('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeModuleId]);

  // bd-klecr — the provider, level and course pages take their selection from
  // the URL. Only ever SET here, never cleared: the unit and exam pages have no
  // vendor/level in their URL and rely on the selection the teacher walked in
  // with (or the one the module detail restores).
  useEffect(() => {
    if (routeVendorKey && routeVendorKey !== selectedVendor) setSelectedVendor(routeVendorKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeVendorKey]);
  useEffect(() => {
    if (routeLevelId && routeLevelId !== selectedLevel) setSelectedLevel(routeLevelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLevelId]);
  useEffect(() => {
    if (routeCourseId && routeCourseId !== selectedCourse) setSelectedCourse(routeCourseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCourseId]);

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

  // bd-60172 — bumped when a certificate is issued, so the shelf refetches.
  // Levels and certificates are two different reads; refreshing the first was
  // never going to update the second, which is why a teacher who had just
  // earned one had to reload the page to see it.
  const [certReloadKey, setCertReloadKey] = useState(0);
  const onCertificateIssued = useCallback(() => {
    setCertReloadKey(k => k + 1);
    void refreshLevels();
  }, [refreshLevels]);

  // bd-klecr — the count on the Certificates button. Read from the same list
  // the certificates page shows (a pure read, never mints), so the two cannot
  // disagree. null until it answers: the button shows no number rather than a
  // 0 that is really "not loaded yet".
  const [certCount, setCertCount] = useState<number | null>(null);
  // Bumped on returning to the Training page, so a certificate earned on
  // another page is counted without a reload.
  const [certCountKey, setCertCountKey] = useState(0);
  useEffect(() => {
    let live = true;
    api.get('/training/certificates')
      .then(({ data }) => { if (live) setCertCount((data.certificates || []).length); })
      .catch(() => { /* the button still opens the page, which reports its own error */ });
    return () => { live = false; };
  }, [certReloadKey, certCountKey]);

  // bd-xga3l — each page re-reads what it shows when you come back to it.
  //
  // Operator, 2026-10-02 (sandbox): after finishing the last Beacon House
  // English module the level card still read 4/5 while the database held
  // 55/55. Levels, courses and the provider roll-up were each read ONCE — on
  // first load, or when the selection changed — and walking back up the
  // breadcrumb (or Back) changes neither, so the counts were the ones from
  // before the work was done.
  //
  // Silent on purpose: no spinner and no cleared selection, just the newer
  // numbers. Skipped on first load (the mount fetches already ran) and when a
  // NEW level is opened (the courses effect fetches that one itself).
  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    const here = `${screenKind}|${routeVendorKey ?? ''}|${routeLevelId ?? ''}|${routeCourseId ?? ''}`;
    const prev = lastScreen.current;
    lastScreen.current = here;
    if (prev === null || prev === here) return;

    if (screenKind === 'home') {
      api.get('/training/vendors')
        .then(({ data }) => setVendors(data.vendors || []))
        .catch(() => { /* keep the cards already on screen */ });
      setCertCountKey(k => k + 1);
    } else if (screenKind === 'provider') {
      void refreshLevels();
    } else if ((screenKind === 'level' || screenKind === 'course')
      && routeLevelId && routeLevelId === selectedLevel) {
      api.get('/training/courses', { params: { level_id: routeLevelId } })
        .then(({ data }) => setCourses(data.courses || []))
        .catch(() => { /* keep the cards already on screen */ });
    }

    // bd-bvtv9 — and the course page re-reads its module list: the unit ticks,
    // the module exam's gate and the readings all ride on /training/modules.
    // Operator, 2026-10-02 (sandbox): every I-SAPS Module 1 unit was complete
    // in the database, yet back on this page the last unit had no tick and
    // the exam was still locked — the list was from before the unit was done.
    // Only for the course already open; a different course fetches itself.
    if (screenKind === 'course' && routeCourseId && routeCourseId === selectedCourse) {
      const courseId = routeCourseId;
      api.get('/training/modules', { params: { course_id: courseId } })
        .then(({ data }) => {
          const list: ModuleSummary[] = data.modules || [];
          setModules(list);
          setModuleExam(data.exam || null);
          setModuleReadings(data.readings || null);
          list.forEach(m => {
            api.get(`/training/module/${m.id}/attempts`)
              .then(({ data: d }) => setAttemptsByModule(prev => ({ ...prev, [m.id]: d.attempts || [] })))
              .catch(() => { /* keep the badge already on screen */ });
          });
        })
        .catch(() => { /* keep the list already on screen */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKind, routeVendorKey, routeLevelId, routeCourseId]);

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
    // bd-60152 — this guard drops a level the teacher can no longer see (a
    // band change, a revoked assignment). It must NOT run while a URL owns
    // the selection, and it must NOT run before the level list has arrived.
    //
    // Both were wrong, and together they were the whole "navigation doesn't
    // work" bug. visibleLevels is [] on first paint, so ANY selected level
    // looks absent from it — the guard then fired on a perfectly valid level
    // and wiped selectedModule, which the route had just set. The detail
    // fetch keys on selectedModule, so it never ran: on a deep link the page
    // issued only /vendors and /levels and nothing else, leaving a unit page
    // with no unit and both arrows dead.
    if (onSubPage) return;
    if (visibleLevels.length === 0) return;
    if (!visibleLevels.some(l => String(l.id) === selectedLevel)) {
      setSelectedLevel('');
      setSelectedCourse('');
      setSelectedModule('');
      setCourses([]);
      setModules([]); setModuleExam(null); setModuleReadings(null);
      setModuleDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLevels, selectedLevel, onSubPage]);

  // bd-klecr — there is no auto-select any more, for one provider, one level
  // or one course. Each is its own page and every page always shows (operator,
  // 2026-10-02: "every page should always show, we will see that later"). An
  // auto-select here would also fight the URL, which now owns the selection.

  const handleLevelChange = useCallback((val: string) => {
    const lvl = levels.find(l => String(l.id) === val);
    if (lvl && lvl.state === 'locked') {
      toast({
        title: 'Level locked',
        description: `Pass the Level ${(lvl.previous_level_order ?? 0) + 1} exam first.`,
      });
      return;
    }
    if (selectedVendor) navigate(levelUrl(selectedVendor, val));
  }, [levels, toast, selectedVendor, navigate, levelUrl]);

  useEffect(() => {
    setCourses([]); setModules([]);
    // bd-60152 — the THIRD effect that tore down URL-owned state, and the one
    // the instrumentation actually caught clearing it (a deep link set
    // selectedModule, then this ran when the level auto-picked and wiped it).
    //
    // Changing level legitimately invalidates the open unit when the teacher
    // is browsing. On a unit URL the opposite is true: the level is being
    // restored *because* of that unit, so clearing it here threw away the
    // very selection that caused the fetch, and the detail request was never
    // issued at all.
    if (!urlOwnsCourse) { setModuleDetail(null); setSelectedCourse(''); setSelectedModule(''); }
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

  useEffect(() => {
    setModules([]);
    // bd-60152 — do NOT clear the selection OR the detail when the URL names a
    // unit.
    //
    // This unconditionally reset selectedModule, which fought the route: a
    // deep link set the unit, then this effect wiped it the moment the course
    // resolved, and the page fell back to the picker.
    //
    // Clearing moduleDetail here was the second half of the same bug, and the
    // reason the arrows stayed grey after the first fix. On a deep link the
    // order is: detail arrives -> the restore effect reads its course -> that
    // sets selectedCourse -> which re-runs THIS effect -> which nulled the
    // very detail the restore had just read. The detail fetch keys on
    // selectedModule alone, so it never re-ran, the restore's `if
    // (!moduleDetail) return` bailed forever, and moduleIndex stayed -1 with
    // both arrows disabled. The URL owns this state; a course change that the
    // URL itself caused must not tear it down.
    if (!routeModuleId) { setSelectedModule(''); setModuleDetail(null); }
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
        setModuleReadings(data.readings || null);
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
    // bd-zgme6 — tick the module only on a pass. The server writes progress
    // only then (bd-2450); ticking a failed attempt showed "Completed" for a
    // module the database still holds as not done.
    if (!completesModule(attempt)) return;
    const completedAt = attempt.completed_at || new Date().toISOString();
    setModules(prev => prev.map(m => (sameId(m.id, moduleId) && !m.completed_at ? { ...m, completed_at: completedAt } : m)));
    setModuleDetail(prev => (prev && sameId(prev.id, moduleId) && !prev.completed_at ? { ...prev, completed_at: completedAt } : prev));
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
      setModules(prev => prev.map(m => (sameId(m.id, moduleDetail.id) ? { ...m, completed_at: completedAt } : m)));
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
    () => (selectedModule ? modules.findIndex(m => sameId(m.id, selectedModule)) : -1),
    [modules, selectedModule],
  );
  const prevModule = moduleIndex > 0 ? modules[moduleIndex - 1] : null;
  const nextModule =
    moduleIndex >= 0 && moduleIndex < modules.length - 1 ? modules[moduleIndex + 1] : null;

  // bd-60156 — the breadcrumb's three labels.
  //
  // Each falls back rather than rendering an empty crumb: on a deep link the
  // detail arrives before courses/levels do, and a crumb that flickers from
  // blank to a name reads as a glitch. moduleDetail carries its own course and
  // level, so it is the most reliable source once it lands.
  // bd-klecr — on a unit page the URL names no provider or level, so they come
  // from the level the module detail carries (a deep link) or the selection
  // the teacher walked in with.
  const crumbLevelId = moduleDetail?.level?.id != null
    ? String(moduleDetail.level.id)
    : selectedLevel;
  const crumbLevelObj = levels.find(l => String(l.id) === crumbLevelId) ?? null;
  const crumbVendorKey = (onSubPage ? crumbLevelObj?.vendor_key : null) || selectedVendor || null;
  const vendorLabel = (key: string | null) =>
    key ? (VENDOR_BRAND[key]?.label ?? vendors.find(v => v.vendor_key === key)?.vendor_name ?? key) : null;
  const crumbVendor = vendorLabel(crumbVendorKey) ?? 'Training';
  const crumbLevelName = crumbLevelObj?.name ?? moduleDetail?.level?.name ?? null;
  // On the EXAM page the module is the middle crumb and "Module exam" is the
  // leaf. Naming the course as the leaf would give the exam a breadcrumb
  // identical to the module's, so a teacher mid-exam could not tell from the
  // trail which of the two she had open.
  const crumbCourse = routeExamCourseId
    ? (courses.find(c => sameId(c.id, routeExamCourseId))?.title ?? null)
    : (moduleDetail?.course?.title ?? null);
  const crumbLeaf = routeExamCourseId
    ? 'Module exam'
    : (moduleDetail?.title ?? 'Session');

  const selectedCourseObj = useMemo(
    () => courses.find(c => sameId(c.id, selectedCourse)) ?? null,
    [courses, selectedCourse],
  );

  // Back from a unit or exam to its course's module list. Falls back to the
  // Training page when the provider or level is not known (an old deep link
  // whose level is not in this teacher's list), rather than a broken URL.
  const backCourseId = routeExamCourseId || moduleDetail?.course?.id || selectedCourse;
  const backToCourse = () => {
    if (crumbVendorKey && crumbLevelId && backCourseId) {
      navigate(courseUrl(crumbVendorKey, crumbLevelId, String(backCourseId)));
    } else {
      navigate(routeBase);
    }
  };

  if (loadingLevels || loadingVendors) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  const noAssignment = levelsLoaded && levels.length === 0;


  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl" data-testid="training-v2-root">

        {/* bd-60156 — the hero belongs to the TRAINING page, not to a unit.
            On a sub-page it is a fifth of the screen of branding above the one
            thing the teacher opened, so the breadcrumb takes its place: it
            says where she is AND gets her back, in one line instead of a
            banner plus three pickers. */}
        {screenKind === 'home' && (
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
              {/* bd-klecr — certificates have their own page; the count says
                  how many are waiting there, 0 included. */}
              <button
                type="button"
                onClick={() => navigate(`${routeBase}/certificates`)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 transition-colors"
                data-testid="certificates-button"
              >
                <Award className="w-4 h-4" />
                Certificates
                {certCount !== null && (
                  <span className="rounded-full bg-white px-2 text-xs font-semibold text-slate-800 tabular-nums">
                    {certCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* bd-klecr — every page below Training says where it is and walks
            back up one step at a time. */}
        {(screenKind === 'provider' || screenKind === 'level' || screenKind === 'course' || screenKind === 'certificates') && (
          <TrainingBreadcrumb
            onTraining={() => navigate(routeBase)}
            crumbs={screenKind === 'certificates'
              ? [{ label: 'Certificates' }]
              : [
                  {
                    label: vendorLabel(routeVendorKey ?? null) ?? 'Provider',
                    testId: 'breadcrumb-vendor',
                    onClick: screenKind === 'provider' ? undefined : () => navigate(providerUrl(routeVendorKey!)),
                  },
                  ...(screenKind === 'level' || screenKind === 'course' ? [{
                    label: selectedLevelObj?.name ?? 'Level',
                    testId: 'breadcrumb-level',
                    onClick: screenKind === 'course' ? () => navigate(levelUrl(routeVendorKey!, routeLevelId!)) : undefined,
                  }] : []),
                  ...(screenKind === 'course' ? [{ label: selectedCourseObj?.title ?? 'Course' }] : []),
                ]}
          />
        )}

        {onSubPage && (
          <nav
            className="flex flex-wrap items-center gap-2 mb-5 text-sm min-w-0"
            aria-label="Breadcrumb"
            data-testid="unit-breadcrumb"
          >
            <button
              type="button"
              onClick={() => navigate(routeBase)}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="breadcrumb-training"
            >
              <ChevronLeft className="w-4 h-4" />
              Training
            </button>
            {crumbVendorKey && (
              <>
                <span className="text-muted-foreground/50" aria-hidden="true">/</span>
                <button
                  type="button"
                  onClick={() => navigate(providerUrl(crumbVendorKey))}
                  className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  data-testid="breadcrumb-vendor"
                >
                  {crumbVendor}
                </button>
              </>
            )}
            {crumbVendorKey && crumbLevelId && crumbLevelName && (
              <>
                <span className="text-muted-foreground/50" aria-hidden="true">/</span>
                <button
                  type="button"
                  onClick={() => navigate(levelUrl(crumbVendorKey, crumbLevelId))}
                  className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  data-testid="breadcrumb-level"
                >
                  {crumbLevelName}
                </button>
              </>
            )}
            {crumbCourse && (
              <>
                <span className="text-muted-foreground/50" aria-hidden="true">/</span>
                <button
                  type="button"
                  onClick={backToCourse}
                  className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  data-testid="breadcrumb-course"
                >
                  {crumbCourse}
                </button>
              </>
            )}
            <span className="text-muted-foreground/50" aria-hidden="true">/</span>
            <span className="font-semibold text-foreground truncate" aria-current="page">
              {crumbLeaf}
            </span>
          </nav>
        )}

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

        {/* bd-60156 — the picker is the TRAINING page. A unit or exam page
            shows the one thing the teacher opened and the way back, nothing
            else: the provider grid, the certificates shelf and the level rail
            all belong to choosing, and she has already chosen. The provider
            grid was also a live control sitting above a unit she was reading —
            one tap changed what the page was about mid-session. */}
        {!noAssignment && (
          <>
            {screenKind === 'home' && (
              <VendorCards vendors={vendors} onOpen={key => navigate(providerUrl(key))} />
            )}

            {screenKind === 'provider' && (
              <>
                <LevelRail
                  levels={visibleLevels}
                  selectedLevel=""
                  onSelect={handleLevelChange}
                  tint={selectedVendor ? (VENDOR_BRAND[selectedVendor]?.tint ?? null) : null}
                />
                {visibleLevels.length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="provider-no-levels">
                    No levels from this provider are assigned to you.
                  </p>
                )}
              </>
            )}

            {screenKind === 'certificates' && (
              <div data-testid="certificates-page">
                <CertificatesPanel
                  alwaysOpen
                  byProvider={key => vendorLabel(key) ?? key}
                  reloadKey={certReloadKey}
                />
              </div>
            )}

            {/* Written-capstone history for non-chain levels (bd-2233). */}
            {screenKind === 'level' && selectedLevelObj && (selectedLevelObj.unlock_logic || 'chain') !== 'chain' && (
              <CapstoneResultCard
                key={`cap-${selectedLevelObj.id}`}
                levelId={selectedLevelObj.id}
                levelName={selectedLevelObj.name}
              />
            )}

            {/* The level exam belongs to the LEVEL, so it sits above the
                course/module lists rather than below the open module. */}
            {screenKind === 'level' && selectedLevelObj && selectedLevelObj.state !== 'locked'
              && !LEVEL_EXAMLESS_VENDORS.has(String(selectedLevelObj.vendor_key || '').toUpperCase()) && (
              <div className="mb-8">
                <LevelExamCard
                  key={selectedLevelObj.id}
                  levelId={selectedLevelObj.id}
                  levelName={selectedLevelObj.name}
                  levelOrderIndex={selectedLevelObj.order_index}
                  onCertified={onCertificateIssued}
                />
              </div>
            )}

            {/* bd-klecr — the LEVEL page: this level's courses as cards, and
                nothing below them. A course opens on its own page with its
                modules (operator, 2026-10-02: "the courses of that level
                should be on next page and then the linked modules of that
                course on next page, not on same pages"). */}
            {screenKind === 'level' && (
              <section className="mb-8" data-testid="course-list">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-semibold text-foreground">Courses</h2>
                  {!loadingCourses && courses.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {courses.length} {courses.length === 1 ? 'course' : 'courses'}
                    </span>
                  )}
                </div>
                {loadingCourses && (
                  // bd-fxk3t8 — placeholder rows where the courses will be, not a spinner.
                  <SkeletonList rows={2} className="p-3" />
                )}
                {!loadingCourses && courses.length === 0 && (
                  <p className="text-sm text-muted-foreground">No courses in this level.</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {courses.map((c, i) => {
                    const done = c.module_count > 0 && c.completed_count >= c.module_count;
                    const pct = c.module_count > 0
                      ? Math.round((c.completed_count / c.module_count) * 100)
                      : 0;
                    const bar = (selectedVendor && VENDOR_BRAND[selectedVendor]?.tint) || '#47ba7d';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectedVendor && navigate(courseUrl(selectedVendor, selectedLevel, c.id))}
                        data-testid={`course-card-${c.id}`}
                        className="text-left rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold tracking-wider text-muted-foreground">
                            COURSE {i + 1}
                          </span>
                          {done && <CheckCircle2 className="w-4 h-4 text-green-700" />}
                        </div>
                        <div className="text-base font-semibold text-foreground mb-3">{c.title}</div>
                        <div
                          className="h-2 rounded-full bg-muted overflow-hidden mb-2.5"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${c.title} progress`}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: done ? '#15803d' : bar }}
                          />
                        </div>
                        <div className={`text-sm font-medium ${done ? 'text-green-700' : 'text-foreground'}`}>
                          {c.completed_count} / {c.module_count} modules
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* bd-60152 — the level's certificate, after its courses — for a
                    per-module-assessed level ONLY (I-SAPS). There is no level
                    exam to hand it over there, the card tracks the module
                    exams, and it is how a held written-answer result is
                    collected once released.

                    Not shown for anyone else (operator, 2026-10-02): NIETE's
                    level exam, Beacon House's capstone and Oxbridge's quiz
                    scores all issue the certificate on passing, so the row was
                    only a fallback, and the Certificates page now holds the
                    download. */}
                {selectedLevelObj
                  && LEVEL_EXAMLESS_VENDORS.has(String(selectedLevelObj.vendor_key || '').toUpperCase()) && (
                  <div className="mt-4 rounded-2xl border bg-card p-2 shadow-sm">
                    <LevelCertificateRow
                      key={`cert-${selectedLevelObj.id}-${certTick}`}
                      levelId={selectedLevelObj.id}
                      onIssued={onCertificateIssued}
                    />
                  </div>
                )}
              </section>
            )}

            {/* bd-klecr — the COURSE page: its modules, its exam and its
                readings. A module opens on the unit page.

                bd-klecr.5 — the modules are CARDS, like the provider, level
                and course cards one step up (operator, 2026-10-06, design
                option A). A module's own assessment is a line INSIDE its card
                (bd-60149 made it a second row; both rows opened the same unit,
                and the second row cut long titles short on a phone). The lock
                is still the bot's (bd-vej4h, unitRowState): a locked card is
                disabled and says in words which module opens it, because the
                hover hint never reached a phone.

                Operator, 2026-10-06 (design option 1): a done card stays
                WHITE, with a small green "Completed" badge; the green-filled
                card turned the whole page green once most modules were done.
                The very first module never says "Up next": nothing is behind
                it, so "next" says nothing (its outline still marks the start). */}
            {screenKind === 'course' && (
              <section className="mb-8" data-testid="module-list">
                <div className="flex items-baseline justify-between mb-3 gap-3">
                  <h2 className="text-base font-semibold text-foreground">Modules</h2>
                  {selectedCourseObj && (
                    <span className="text-sm text-muted-foreground shrink-0">
                      {selectedCourseObj.completed_count} of {selectedCourseObj.module_count} complete
                    </span>
                  )}
                </div>

                {loadingModules && (
                  // bd-fxk3t8 — placeholder rows where the modules will be, not a spinner.
                  <SkeletonList rows={2} className="p-3" />
                )}

                {/* The third distinct outcome: a real answer that is empty. */}
                {!loadingModules && selectedCourse && modules.length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="training-empty-modules">
                    {EMPTY_MODULES_MESSAGE}
                  </p>
                )}

                {modules.length > 0 && (() => {
                  const bar = (selectedVendor && VENDOR_BRAND[selectedVendor]?.tint) || '#47ba7d';
                  // Up next: the first module neither done nor locked.
                  const nextId = modules.find(m => !m.completed_at && !unitRowState(m).disabled)?.id;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="module-grid">
                      {modules.map((m, i) => {
                        const active = sameId(m.id, selectedModule);
                        const attempts = attemptsByModule[m.id];
                        const loading = m.id in attemptsByModule && attempts === null;
                        const row = unitRowState(m);
                        const done = !!m.completed_at;
                        const isNext = !row.disabled && sameId(m.id, nextId);
                        const showNextTag = isNext && i > 0;
                        const highlight = active || isNext;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { if (!row.disabled) openUnit(m.id); }}
                            disabled={row.disabled}
                            title={row.hint || undefined}
                            data-testid={`module-item-${m.id}`}
                            data-done={done ? 'true' : 'false'}
                            data-next={isNext ? 'true' : undefined}
                            data-lock={m.lock || undefined}
                            aria-pressed={active}
                            className={`text-left rounded-xl border p-5 flex flex-col gap-2 transition-all ${
                              row.disabled
                                ? 'border-dashed border-border bg-muted/40 cursor-not-allowed'
                                : 'border-border bg-card shadow-sm hover:shadow-md hover:-translate-y-0.5'
                            }`}
                            style={highlight && !done ? { borderColor: bar, boxShadow: `0 0 0 1px ${bar}` } : undefined}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                                MODULE {i + 1}
                              </span>
                              {done
                                ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700 shrink-0" data-testid="module-done-badge">
                                    <span className="w-5 h-5 rounded-full bg-green-700 text-white inline-flex items-center justify-center">
                                      <Check className="w-3 h-3" strokeWidth={3.5} />
                                    </span>
                                    Completed
                                  </span>
                                )
                                : row.disabled
                                  ? <Lock className="w-4 h-4 text-muted-foreground shrink-0" aria-label="Locked" />
                                  : showNextTag
                                    ? (
                                      <span
                                        className="text-xs font-semibold text-white rounded-full px-2 py-0.5 shrink-0"
                                        style={{ backgroundColor: bar }}
                                      >
                                        Up next
                                      </span>
                                    )
                                    : null}
                            </div>

                            <div className={`text-base font-semibold ${row.disabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                              {m.title}
                            </div>

                            {row.disabled ? (
                              <div className="mt-auto pt-3 border-t flex items-center gap-2 text-sm text-muted-foreground">
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                {i > 0 ? `Finish Module ${i} first` : row.hint}
                              </div>
                            ) : (m.duration_seconds > 0 || m.has_questions) ? (
                              <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2 text-sm">
                                {m.duration_seconds > 0 ? (
                                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                    <Clock className="w-3.5 h-3.5" />
                                    {formatDuration(m.duration_seconds)}
                                  </span>
                                ) : <span />}
                                {m.has_questions && (
                                  <span
                                    className="inline-flex items-center gap-1.5 text-muted-foreground"
                                    data-testid={`module-assessment-${m.id}`}
                                  >
                                    Quiz
                                    {/* Never a bare dash on a card: no attempt reads "Not attempted". */}
                                    <QuizScoreBadge attempts={attempts ?? null} moduleCompleted loading={loading} />
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* bd-60149 — the module's summative exam, AFTER its units,
                    which is where a teacher looks for it; then the I-SAPS
                    recommended reading (operator, 2026-09-23), collapsed by
                    default, gating nothing. Both sit in one card under the
                    module cards, like the level page's certificate row.
                    Renders nothing when the course has neither. */}
                {selectedCourse && (moduleExam || moduleReadings?.available?.length || moduleReadings?.unavailable?.length) ? (
                  <div className="mt-4 rounded-2xl border bg-card p-2 shadow-sm" data-testid="module-extras">
                    {moduleExam && (
                      <ModuleExamPanel
                        key={`exam-${selectedCourse}`}
                        courseId={String(selectedCourse)}
                        exam={moduleExam}
                        asListRow
                        onOpen={() => openExam(String(selectedCourse))}
                        onPassed={() => {
                          if (!selectedCourse) return;
                          setCertTick(t => t + 1);
                          api.get('/training/modules', { params: { course_id: selectedCourse } })
                            .then(({ data }) => {
                              setModules(data.modules || []);
                              setModuleExam(data.exam || null);
                            })
                            .catch(() => { /* the pass is recorded server-side either way */ });
                        }}
                      />
                    )}
                    <ModuleReadings readings={moduleReadings} />
                  </div>
                ) : null}
              </section>
            )}

            {/* ── The open module ──────────────────────────────────────── */}
            {loadingDetail && (
              // bd-fxk3t8 — the module card's lines held by placeholders, not a spinner.
              <div aria-busy="true" className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm">
                <SkeletonLine className="h-5 w-1/2" />
                <SkeletonLine className="w-5/6" />
                <SkeletonLine className="w-2/3" />
              </div>
            )}

            {/* bd-60152 — the way OUT of the unit page. Without it the only
                route back to the module list is the browser's back button,
                which a teacher on a phone will not reliably find. */}
            {onSubPage && (
              <button
                type="button"
                onClick={backToCourse}
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="unit-back"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to modules
              </button>
            )}

            {/* bd-60152 — the module exam as its own PAGE.
                It was rendered only inside the module list, which the unit
                page hides — so opening a unit made the exam vanish, and there
                was nowhere to sit it with the room a written answer needs. */}
            {routeExamCourseId && moduleExam && (
              <div className="rounded-2xl border bg-card shadow-sm overflow-hidden" data-testid="module-exam-page">
                <div className="p-6 border-b">
                  <h2 className="text-xl font-medium text-foreground">
                    {selectedCourseObj ? selectedCourseObj.title : 'Module exam'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Module exam</p>
                </div>
                <div className="px-6 pb-6">
                  <ModuleExamPanel
                    key={`exampage-${routeExamCourseId}`}
                    courseId={String(routeExamCourseId)}
                    exam={moduleExam}
                    autoStart
                    onPassed={() => {
                      api.get('/training/modules', { params: { course_id: routeExamCourseId } })
                        .then(({ data }) => {
                          setModules(data.modules || []);
                          setModuleExam(data.exam || null);
                        })
                        .catch(() => { /* the pass is recorded server-side either way */ });
                    }}
                    onSubmitted={() => {
                      // bd-2exhl — re-read the gate so the list row stops offering
                      // a paper that is now being graded or was just failed.
                      api.get('/training/modules', { params: { course_id: routeExamCourseId } })
                        .then(({ data }) => { setModuleExam(data.exam || null); })
                        .catch(() => { /* the panel already shows the sitting from the record */ });
                    }}
                  />
                </div>
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
                        onClick={() => prevModule && openUnit(prevModule.id)}
                        aria-label="Previous module"
                        data-testid="module-prev"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={!nextModule}
                        onClick={() => nextModule && openUnit(nextModule.id)}
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
                    moduleId={String(moduleDetail.id)}
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
                    <Button variant="outline" onClick={() => openUnit(nextModule.id)}>
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Continue
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Band editing stays available once training IS assigned, on the
                Training page where the assignment is chosen. */}
            {screenKind === 'home' && levels.length > 0 && (
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
