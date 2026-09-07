/**
 * Response-side observability for the Pakistan LP Flow endpoint (bd-oak77.26).
 *
 * WHY THIS EXISTS
 * ---------------
 * `pakistan-lp-endpoint.js` logged one line per data_exchange —
 * `{flowToken, screen, step}` — and nothing at all about what it handed back.
 * So on 2026-09-07 a teacher hit Meta's "Something went wrong. Try again
 * later." on the "Pick a lesson" screen and the logs could not say whether we
 * had returned a screen, returned `{data:{error:…}}` (which is EXACTLY what
 * renders as that message), returned a screen Meta rejected, or never been
 * reached at all. A success and a refusal were the same row.
 *
 * This module is telemetry only. It returns nothing to the Flow, changes no
 * copy, and every function in it is written so that a failure inside it can
 * never reach the teacher (root CLAUDE.md rule 24(b): a silent fallback is a
 * regression mask, so the failure is logged rather than swallowed in silence).
 *
 * WHAT IT EMITS  (all under the `lp612.` prefix, `msg` in Axiom `niete-logs`)
 *   lp612.flow.response     — one per INIT / data_exchange / BACK. Always.
 *   lp612.flow.error_screen — ADDITIONALLY, whenever we hand Meta an error
 *                             object or throw. This is the greppable,
 *                             countable "the teacher saw the red screen" event.
 *   lp612.flow.cap_breach   — one per breached WhatsApp limit on a screen we
 *                             are about to return, with the measured value.
 *
 * PRIVACY: the raw flow token and the phone number are never emitted. The user
 * uuid is — it is the join key, and `lp612.tap.received` already carries it.
 */

const { logEvent } = require('../utils/structured-logger');
const { logToFile } = require('../utils/logger');

// ─── the caps ────────────────────────────────────────────────────────────
//
// Sources, not guesses:
//   * `.claude/skills/whatsapp-flows/SKILL.md` rule 15 ("The caps, in CODE
//     POINTS") — title 30 · description 20 · metadata 80 · 20 rows per
//     NavigationList; and its "Meta Flow hard limits" table — data_exchange
//     payload ~1 MB.
//   * The same four numbers are what `lp-v8-catalog.service.js` clips to
//     (TITLE_CAP / DESC_CAP / META_CAP / PAGE_SIZE). A test asserts the two
//     agree, so a change on either side breaks the build rather than drifting.
//
// CODE POINTS, never `String.length`: the two diverge on Urdu and on emoji,
// and this lane serves Urdu.
const NAV_CAPS = Object.freeze({ title: 30, description: 20, metadata: 80 });
const NAV_MAX_ITEMS = 20;
const RESPONSE_BYTES_CAP = 1000000;

/**
 * The screens the PUBLISHED Flow declares. Returning a screen id the Flow does
 * not declare is a guaranteed Meta rejection — and today it is invisible.
 *
 * Source: the live prod Flow JSON `945974604563079` ("Pakistan LP v3.2 (6-12
 * menu)", version 7.0), fetched from Graph on 2026-09-06 and byte-identical to
 * the checked-in `docs/flows/pakistan-lp-flow-v3.json`. A test asserts this
 * list still equals that file's screen ids, so republishing a Flow with a new
 * screen without updating this constant fails the suite.
 */
const KNOWN_SCREENS = Object.freeze([
  'SELECT_GRADE',
  'SELECT_SUBJECT',
  'SELECT_CHAPTER',
  'SELECT_CHAPTER_MORE',
  'SELECT_LESSON',
  'SELECT_LESSON_MORE',
  'SELECT_LANGUAGE',
  'SUCCESS',
]);

// ─── step vocabulary ─────────────────────────────────────────────────────
//
// Two corpora ride one Flow and one endpoint. Until now the only way to tell
// their traffic apart in Axiom was to read `step` per row and know by heart
// which names belong to which lane. `vocab` puts that in one field so a single
// query can say "6-12 error rate" or "K-5 error rate".
const LP612_STEPS = Object.freeze([
  'lp612_subject', 'lp612_chapter', 'lp612_chapter_page',
  'lp612_segment', 'lp612_segment_page', 'lp612_serve',
]);
const K5_SHARED_STEPS = Object.freeze([
  'grade', 'subject', 'chapter', 'lesson', 'lesson_page',
]);

/** Code points, not UTF-16 units. */
const cps = (s) => [...String(s)].length;

/**
 * Which vocabulary the INBOUND payload speaks.
 *
 * `grade`/`subject`/`chapter`/`lesson` are reported as `k5_shared` rather than
 * `k5`, honestly: `selectGrade` serves grades 6-12 through the same step names,
 * so the vocabulary names the Flow's row wiring, not the corpus. The `grade`
 * field on the same event says which class was actually asked for.
 */
function stepVocabulary(step, screen) {
  if (typeof step === 'string' && step) {
    if (LP612_STEPS.includes(step)) return 'lp612';
    if (K5_SHARED_STEPS.includes(step)) return 'k5_shared';
    return 'unknown_step';
  }
  return screen ? 'v2_screen' : 'none';
}

/**
 * The bytes Meta actually receives. `processEncryptedRequest` runs the response
 * JSON through AES-128-GCM (a stream cipher — no padding), appends the 16-byte
 * auth tag, and base64s the result. So the wire size is exact, not a guess:
 * ceil((plaintext + 16) / 3) * 4.
 */
const wireBytes = (plaintextBytes) => Math.ceil((plaintextBytes + 16) / 3) * 4;

/**
 * What did we hand back? `outcome` is the field this whole module exists for.
 *
 *   screen  — a screen for Meta to render
 *   error   — `{data:{error:{message}}}`; the teacher sees Meta's red
 *             "Something went wrong. Try again later."
 *   throw   — the dispatcher threw; the route answers 500 and the teacher sees
 *             the same red screen
 *   unknown — neither shape. Should never happen; if it does we want to know.
 */
function describeResponse(response) {
  const out = { outcome: 'unknown', screen: null, itemCount: null, bytes: null, errorMessage: null };
  if (!response || typeof response !== 'object') return out;
  try {
    out.bytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
  } catch (_) {
    out.bytes = null;
  }
  const data = response.data;
  const err = data && typeof data === 'object' ? data.error : null;
  if (err) {
    out.outcome = 'error';
    out.errorMessage = typeof err === 'string' ? err : (err.message ? String(err.message) : null);
    return out;
  }
  if (typeof response.screen === 'string' && response.screen) {
    out.outcome = 'screen';
    out.screen = response.screen;
    if (data && Array.isArray(data.items)) out.itemCount = data.items.length;
  }
  return out;
}

/**
 * Every WhatsApp limit that would make Meta reject the screen we are about to
 * return, measured on the actual object. Returns [] for a healthy screen.
 *
 * Deliberately does NOT clip, drop or alter anything: the operator's rule for
 * this lane is telemetry only. A breach is reported loudly and still shipped,
 * so the log tells us what Meta saw rather than hiding it behind a repair.
 */
function capBreaches(response) {
  const breaches = [];
  if (!response || typeof response !== 'object') return breaches;

  const screen = typeof response.screen === 'string' ? response.screen : null;
  if (screen && !KNOWN_SCREENS.includes(screen)) {
    breaches.push({ kind: 'unknown_screen', field: 'screen' });
  }

  const data = response.data && typeof response.data === 'object' ? response.data : {};
  if (Array.isArray(data.items)) {
    if (data.items.length > NAV_MAX_ITEMS) {
      breaches.push({ kind: 'nav_items', field: 'items', measured: data.items.length, cap: NAV_MAX_ITEMS });
    }
    data.items.forEach((item, itemIndex) => {
      const mc = item && typeof item === 'object' ? item['main-content'] : null;
      if (!mc || typeof mc !== 'object') return;
      Object.keys(NAV_CAPS).forEach((field) => {
        const v = mc[field];
        if (v === undefined || v === null) return;
        const measured = cps(v);
        if (measured > NAV_CAPS[field]) {
          breaches.push({
            kind: 'nav_text',
            field,
            measured,
            cap: NAV_CAPS[field],
            itemIndex,
            itemId: item.id === undefined || item.id === null ? null : String(item.id),
          });
        }
      });
    });
  }

  let bytes = null;
  try {
    bytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
  } catch (_) { /* circular — nothing to measure */ }
  if (bytes !== null && bytes > RESPONSE_BYTES_CAP) {
    breaches.push({
      kind: 'response_bytes', field: 'response', measured: bytes, cap: RESPONSE_BYTES_CAP,
      wireMeasured: wireBytes(bytes),
    });
  }

  return breaches;
}

/**
 * The identifying fields off the INBOUND payload — what the teacher asked for.
 *
 * Curriculum coordinates only. No flow token, no phone number: a token is
 * `<userId>:pakistan-lp:<ts>` and logging it whole would put a joinable session
 * id in every row for no diagnostic gain, and the phone is teacher PII.
 */
function identityFields(payload) {
  const d = payload && typeof payload === 'object' ? payload : {};
  const s = (v) => (v === undefined || v === null || v === '' ? undefined : String(v));
  return {
    step: s(d.step),
    grade: s(d.grade),
    subject: s(d.subject),
    chapterKey: s(d.chapter_key !== undefined ? d.chapter_key : d.chapter),
    bookStem: s(d.book_stem),
    segmentId: s(d.segment_id),
    lessonId: s(d.lesson),
    page: s(d.page),
    lang: s(d.lang),
  };
}

const compact = (obj) => {
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  });
  return out;
};

/**
 * Emit the response events for one Flow request. Never throws, never returns
 * anything the caller acts on.
 */
function observeFlowResponse(ctx) {
  try {
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const payload = c.payload && typeof c.payload === 'object' ? c.payload : {};
    const desc = describeResponse(c.response);
    const thrown = c.error || null;
    const outcome = thrown ? 'throw' : desc.outcome;

    const base = compact({
      action: c.action,
      screenIn: c.screenIn,
      screenOut: desc.screen,
      vocab: stepVocabulary(payload.step, c.screenIn),
      outcome,
      itemCount: desc.itemCount,
      bytes: desc.bytes,
      wireBytesEst: desc.bytes === null ? undefined : wireBytes(desc.bytes),
      durationMs: Number.isFinite(c.startedAt) ? Date.now() - c.startedAt : undefined,
      userId: c.userId,
      ...identityFields(payload),
    });

    logEvent('lp612.flow.response', base);

    if (outcome === 'error' || outcome === 'throw') {
      logEvent('lp612.flow.error_screen', compact({
        ...base,
        errorKind: outcome === 'throw' ? 'thrown' : 'error_object',
        errorMessage: outcome === 'throw'
          ? (thrown && thrown.message ? String(thrown.message) : null)
          : desc.errorMessage,
      }));
    }

    capBreaches(c.response).forEach((breach) => {
      logEvent('lp612.flow.cap_breach', compact({ ...base, ...breach }));
    });
  } catch (err) {
    // Telemetry must never cost a teacher her screen — but a broken observer is
    // itself a regression mask, so it is recorded, not swallowed.
    try {
      logToFile('Pakistan LP: response telemetry failed (non-fatal)', {
        error: err && err.message ? err.message : String(err),
      });
    } catch (_) { /* nothing left to do */ }
  }
}

module.exports = {
  observeFlowResponse,
  // exported for tests and for reuse by anything else that returns a Flow screen:
  describeResponse,
  capBreaches,
  stepVocabulary,
  identityFields,
  wireBytes,
  cps,
  NAV_CAPS,
  NAV_MAX_ITEMS,
  RESPONSE_BYTES_CAP,
  KNOWN_SCREENS,
  LP612_STEPS,
  K5_SHARED_STEPS,
};
