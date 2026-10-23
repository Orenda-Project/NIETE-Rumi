import api from '../../services/api';

/**
 * What the Home card reads and writes: GET /api/portal/me/home and POST /api/portal/me/home/tap
 * (dashboard/routes/portal-teacher-home.routes.js, the build contract). The server chooses everything (the
 * card's rung, the tile order, the scores, the signed quiz home); nothing here guesses. Behind the
 * portal_teacher_home_card switch: when it is off the server answers 404 and this reads as null, so Home is today's.
 */

/** The card's rungs, in the ladder's order (the design rule R5). */
export type HomeCardKind = 'class' | 'coach_report' | 'lesson' | 'observation' | 'first_plan';

/** The tile keys, as Home's TILES names them. */
export type HomeTileKey =
  | 'lessons' | 'coaching' | 'observations' | 'training' | 'assessment' | 'attendance' | 'classes' | 'analytics';

export type HomeCard = {
  kind: HomeCardKind;
  /** DATA (a topic or a date), never copy. */
  title: string;
  /** class: how many in her class played. */
  played?: number;
  /** lesson: a lesson plan or a coaching session. */
  from?: 'lp' | 'coach';
  /** coach_report / observation: its marks and max. Never shown in a headline (the chips carry them). */
  score?: number | null;
  max?: number | null;
  /** The row's date. */
  at?: string;
  /** Where the primary tap goes (the build contract). */
  href: string;
  id?: string;
};

/**
 * Both scores in ONE shape, the report page's (report.ts: never a stand-in zero): marks out of max, a chip only when
 * both are numbers. An observation is scored like a report (FICO marks out of its max), not out of 5.
 */
export type HomeScore = { marks: number | null; max: number | null; at: string; id: string };
export type HomeScores = { coach: HomeScore | null; observation: HomeScore | null };

export type HomeData = {
  now: string;
  order: HomeTileKey[];
  orderOn: boolean;
  card: HomeCard | null;
  scores: HomeScores;
  /** The signed quiz home, "/quiz/teacher/<token>", or null (the bot said off, failed, or she is a coach). */
  quizHome: string | null;
};

/** What a tap names in the log: the card's rung or a chip. Nothing with a name, a phone or free text. */
export type TapKind = HomeCardKind | 'chip_coach' | 'chip_obs' | 'lp_quiz' | 'coach_quiz';

const KINDS: readonly HomeCardKind[] = ['class', 'coach_report', 'lesson', 'observation', 'first_plan'];
const TILE_KEYS: readonly HomeTileKey[] = [
  'lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics',
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Only a same-host quiz home path is followed (it is opened outside the router). */
const QUIZ_HOME = /^\/quiz\/teacher\/[A-Za-z0-9._~-]+$/;

function readCard(v: unknown): HomeCard | null {
  if (!isObj(v) || !KINDS.includes(v.kind as HomeCardKind) || typeof v.href !== 'string') return null;
  const card: HomeCard = { kind: v.kind as HomeCardKind, title: typeof v.title === 'string' ? v.title : '', href: v.href };
  if (typeof v.played === 'number') card.played = v.played;
  if (v.from === 'lp' || v.from === 'coach') card.from = v.from;
  if ('score' in v) card.score = numOrNull(v.score);
  if ('max' in v) card.max = numOrNull(v.max);
  if (str(v.at)) card.at = str(v.at);
  if (str(v.id)) card.id = str(v.id);
  return card;
}

function readScore(v: unknown): HomeScore | null {
  if (!isObj(v) || !str(v.id)) return null;
  return { marks: numOrNull(v.marks), max: numOrNull(v.max), at: str(v.at) ?? '', id: str(v.id) as string };
}

function readScores(v: unknown): HomeScores {
  const s = isObj(v) ? v : {};
  return { coach: readScore(s.coach), observation: readScore(s.observation) };
}

/** The order the server sent, kept only when it names every tile once; otherwise null (Home keeps its own). */
function readOrder(v: unknown): HomeTileKey[] | null {
  if (!Array.isArray(v) || v.length !== TILE_KEYS.length) return null;
  const keys = v.filter((k): k is HomeTileKey => TILE_KEYS.includes(k as HomeTileKey));
  return new Set(keys).size === TILE_KEYS.length ? keys : null;
}

/** Shape the server's answer; anything unreadable is left out, never guessed. */
export function readHome(body: unknown): HomeData | null {
  if (!isObj(body) || body.success !== true) return null;
  const order = readOrder(body.order);
  return {
    now: str(body.now) ?? new Date().toISOString(),
    order: order ?? [...TILE_KEYS],
    orderOn: body.orderOn === true && !!order,
    card: readCard(body.card),
    scores: readScores(body.scores),
    quizHome: typeof body.quizHome === 'string' && QUIZ_HOME.test(body.quizHome) ? body.quizHome : null,
  };
}

let quizHomeMemo: Promise<string | null> | null = null;

/** GET /me/home. Null when the switch is off (404), the server fails, or the answer cannot be read. Never throws. */
export async function fetchHome(): Promise<HomeData | null> {
  const read = Promise.resolve()
    .then(() => api.get('/me/home'))
    .then((res) => readHome(res?.data))
    .catch(() => null);
  // The quiz home is the same for the whole session: the next reader (the LP page) reuses this answer.
  quizHomeMemo = read.then((d) => d?.quizHome ?? null);
  return read;
}

/**
 * The signed quiz home for this session, for a page other than Home (the LP page's "Quiz this lesson"). It reuses
 * the last fetchHome() answer, or asks once. Null when there is none: the button is not drawn.
 */
export function getQuizHome(): Promise<string | null> {
  if (!quizHomeMemo) void fetchHome();
  return quizHomeMemo as Promise<string | null>;
}

/**
 * POST /me/home/tap { kind }: never throws. Resolves (never rejects) once the post settles, so a tap that leaves the
 * page can wait for it (useHomeGo, with a cap); every other caller ignores the promise.
 */
export function tapHome(kind: TapKind): Promise<void> {
  try {
    return Promise.resolve().then(() => api.post('/me/home/tap', { kind })).then(() => undefined, () => undefined);
  } catch { /* the log never stands between her and the page */ }
  return Promise.resolve();
}

/** Tests and sign-out: forget the session's quiz home. */
export function resetHomeMemo(): void { quizHomeMemo = null; }
