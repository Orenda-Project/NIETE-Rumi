'use strict';
/**
 * bd-tbprit.11 — Rifat's "Coaching suggestion" box, the server half (coach_visit_requests.coach_plan, V1.6.17).
 * Amena's answers, 20 Oct: the report flag for the DC team and "Add to my next visit" are stored on the request;
 * the page shows the template at once and swaps in the AI-tailored version when it arrives, keeping the template
 * when the AI fails; the WhatsApp send is a wa.me link, so only the fact that it was opened is stored.
 *
 *   savePlan        her own request only. found 0-3, mode msg|call|visit, flagged / addedToVisit / sent booleans;
 *                   anything else is dropped. Timestamps are stamped here, never taken from the page.
 *   publicPlan      what the card returns: the choices, no AI cache and no timestamps
 *   parseSuggestion the model's JSON, or null when any part is missing or the wrong shape
 *   suggestionFor   cached in coach_plan.ai under language + answer (en1, ur3 …). The model is told to write
 *                   {name}, never given her name or school. A failed or malformed answer is null and caches nothing.
 */

const MODES = ['msg', 'call', 'visit'];
const MAX = 1000;
const FOUND = [
  'The teacher was right: the report missed what she did.',
  'She needs help with the move.',
  "The move doesn't fit her class.",
  'What she described is not in the recording.',
];

const isFound = (v) => Number.isInteger(v) && v >= 0 && v <= 3;

async function rowOf(supabase, coachId, requestId) {
  if (!coachId || !requestId) return null;
  const { data: row } = await supabase.from('coach_visit_requests').select('id, coach_user_id, coach_plan').eq('id', requestId).maybeSingle();
  return row && row.coach_user_id === coachId ? row : null;
}

async function write(supabase, coachId, requestId, plan) {
  const { error } = await supabase.from('coach_visit_requests').update({ coach_plan: plan }).eq('id', requestId).eq('coach_user_id', coachId);
  if (error) throw new Error(error.message);
}

function publicPlan(plan) {
  if (!plan) return null;
  return {
    found: isFound(plan.found) ? plan.found : null,
    mode: MODES.includes(plan.mode) ? plan.mode : null,
    flagged: plan.flagged === true,
    addedToVisit: !!plan.addedToVisitAt,
    sent: !!plan.sentAt,
  };
}

async function savePlan(supabase, coachId, requestId, input = {}, now = new Date()) {
  const row = await rowOf(supabase, coachId, requestId);
  if (!row) return null;
  const at = now.toISOString();
  const plan = { ...(row.coach_plan || {}) };
  if (isFound(input.found)) plan.found = input.found;
  if (MODES.includes(input.mode)) plan.mode = input.mode;
  if (typeof input.flagged === 'boolean') Object.assign(plan, { flagged: input.flagged, flaggedAt: input.flagged ? at : null });
  if (typeof input.addedToVisit === 'boolean') plan.addedToVisitAt = input.addedToVisit ? at : null;
  if (input.sent === true) plan.sentAt = at;
  await write(supabase, coachId, requestId, plan);
  return publicPlan(plan);
}

const text = (v) => (typeof v === 'string' && v.trim() && v.trim().length <= MAX ? v.trim() : null);
const list = (v, n) => (Array.isArray(v) && v.length === n && v.every(text) ? v.map(text) : null);

function parseSuggestion(raw) {
  let o;
  try { o = JSON.parse(String(raw || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch (_) { return null; }
  if (!o || typeof o !== 'object') return null;
  const s = { msg: text(o.msg), qs: list(o.qs, 3), stuck: list(o.stuck, 2), agree: text(o.agree), check: text(o.check), visit: list(o.visit, 3) };
  return Object.values(s).every(Boolean) ? s : null;
}

/** What the grader said, for the prompt: the reasons, the missed step, the evidence lines. No name, no school. */
function promptFor(card, found) {
  const lang = card.language === 'ur' ? 'Urdu' : 'English';
  const p = card.pattern || {};
  const lines = [];
  (card.evidence || []).forEach((e) => {
    (e.moves || []).forEach((m) => lines.push(`- ${m.text}: ${m.evidence || ''}`));
    (e.items || []).forEach((i) => lines.push(`- ${i.name}: ${i.evidence || ''}`));
    if (e.thing) lines.push(`- ${e.thing.text}`);
  });
  return [
    'You help a teacher coach in Islamabad, Pakistan respond to a teacher who disagreed with her AI coaching report.',
    `What the coach found after listening: ${FOUND[found]}`,
    `The teacher's reasons for disagreeing: ${(card.reasons || []).join(', ') || 'none given'}.`,
    p.missed && p.missed.step ? `Step most missed: ${p.missed.step}, in ${p.missed.n} of her last ${p.missed.of} checked lessons.` : '',
    `This is disagreement number ${card.nth || 1} from this teacher.`,
    lines.length ? `What the report said:\n${lines.slice(0, 8).join('\n')}` : '',
    '',
    'Reply with JSON only, no prose: {"msg": string, "qs": [3 strings], "stuck": [2 strings], "agree": string, "check": string, "visit": [3 strings]}.',
    'msg: a short, warm WhatsApp message in Urdu script from the coach to the teacher. Start with "{name} جی،". Write {name} exactly, never a real name.',
    `qs: three questions the coach asks her on a call. stuck: two tips if she gets stuck. agree: one thing to agree for tomorrow. check: what to look for in her next recording. visit: three steps for a classroom visit. Write qs, stuck, agree, check and visit in ${lang}.`,
    'Plain, kind, specific to this lesson. One sentence each.',
  ].filter((l) => l !== '').join('\n');
}

async function suggestionFor(supabase, coachId, requestId, found, deps) {
  const row = await rowOf(supabase, coachId, requestId);
  if (!row) return undefined;
  if (!isFound(found)) return null;
  const card = await deps.card();
  if (!card) return undefined;
  const key = `${card.language === 'ur' ? 'ur' : 'en'}${found}`;
  const cached = row.coach_plan && row.coach_plan.ai && row.coach_plan.ai[key];
  if (cached) return cached;
  let s = null;
  try { s = parseSuggestion(await deps.complete(promptFor(card, found))); } catch (err) {
    console.error('[coach-disagreements] suggestion failed:', err.message);
    return null;
  }
  if (!s) return null;
  const fresh = await rowOf(supabase, coachId, requestId);
  const plan = { ...((fresh && fresh.coach_plan) || {}) };
  plan.ai = { ...(plan.ai || {}), [key]: s };
  try { await write(supabase, coachId, requestId, plan); } catch (err) {
    console.error('[coach-disagreements] suggestion cache failed:', err.message);
  }
  return s;
}

module.exports = { savePlan, publicPlan, parseSuggestion, suggestionFor, promptFor };
