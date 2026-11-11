'use strict';

/**
 * FICO17 v6 — the transcript quality gate (spec §6; bd-qix9oh.1). Deterministic: no model, no I/O.
 *
 * Runs after transcription and before any scoring, on the DC path and the /observe2 moments path. It
 * reads the `[MM:SS] Speaker (LANG): text` lines and says whether the transcript can be scored:
 *
 *   short       coverage = last timestamp (minutes) / period below RECORDING_FULL_SHARE   partial
 *   late_start  first timestamp later than TRANSCRIPT_LATE_START_SEC                      partial
 *   gap         no line for TRANSCRIPT_GAP_MINUTES or more between two lines              partial
 *   loop        consecutive lines with the same words, or one token making up 80% or more
 *               of their tokens, for TRANSCRIPT_LOOP_MINUTES or more                       partial
 *
 * `broken` when the loops add up to more than TRANSCRIPT_BROKEN_SHARE of the period, or when no line
 * carries a timestamp at all (nothing can be placed in the lesson). Callers: `broken` → no scoring
 * call, every DC level `IE`; `partial` → `promptGaps()` goes into the prompt; `ok` → score as usual.
 *
 * `periodMinutes` is the period the coach set (/observe2) or the recording's length (DC). Without one,
 * coverage is judged against the transcript itself (1) and only the other checks apply.
 */

const DEFAULTS = Object.freeze({
  RECORDING_FULL_SHARE: 0.8,
  TRANSCRIPT_LATE_START_SEC: 180,
  TRANSCRIPT_LOOP_MINUTES: 3,
  TRANSCRIPT_GAP_MINUTES: 3,
  TRANSCRIPT_BROKEN_SHARE: 0.5,
});
const LOOP_TOKEN_SHARE = 0.8;

const LINE_RX = /^\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]\s*[^:]*:\s?(.*)$/;

const pad = (n) => String(n).padStart(2, '0');
const clock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

/** A threshold from `env`, or its default when unset or not a positive number. */
function setting(env, key) {
  const raw = env && env[key];
  const n = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key];
}

/** Lower-case, no punctuation (Latin and Urdu ، ۔ ؟), no harakat (U+064B-0652) or superscript alef, one space. */
function norm(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[ً-ْٰ]/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The timed lines, in order; an untimed line continues the line before it. */
function parse(transcript) {
  const lines = [];
  for (const raw of String(transcript || '').split(/\r?\n/)) {
    const m = LINE_RX.exec(raw.trim());
    if (m) {
      lines.push({ sec: Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), text: m[4] });
    } else if (lines.length && raw.trim()) {
      lines[lines.length - 1].text += ` ${raw.trim()}`;
    }
  }
  for (const line of lines) {
    line.key = norm(line.text);
    line.tokens = line.key ? line.key.split(' ') : [];
  }
  return lines;
}

/**
 * Runs of consecutive lines that repeat: every line the same words, or one token at least 80% of the
 * run's tokens. A run grows while that holds, then sheds trailing lines that do not repeat themselves
 * (a long loop's share would otherwise swallow the ordinary speech after it). It counts when it lasts
 * loopSec or more (first line's start to last line's start).
 */
function loops(lines, loopSec) {
  const found = [];
  let i = 0;
  while (i < lines.length) {
    const counts = new Map();
    let total = 0;
    let top = 0;
    let topToken = null;
    let same = true;
    let j = i;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.tokens.length) break;
      for (const t of line.tokens) {
        const c = (counts.get(t) || 0) + 1;
        counts.set(t, c);
        if (c > top) [top, topToken] = [c, t];
      }
      total += line.tokens.length;
      same = same && line.key === lines[i].key;
      if (!same && top < LOOP_TOKEN_SHARE * total) break;
    }
    const repeats = (line) => line.key === lines[i].key
      || line.tokens.filter((t) => t === topToken).length >= LOOP_TOKEN_SHARE * line.tokens.length;
    let last = j - 1;
    while (last > i && !repeats(lines[last])) last -= 1;
    if (last > i && lines[last].sec - lines[i].sec >= loopSec) {
      found.push({ fromSec: lines[i].sec, toSec: lines[last].sec });
      i = last + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/**
 * @param {{ transcript: string, periodMinutes?: number|null, env?: object }} input
 * @returns {{ status: 'ok'|'partial'|'broken', coverage: number, issues: Array<{type, from?, to?}>,
 *   period_minutes: number|null, first_ts: string|null, last_ts: string|null }}
 */
function assess({ transcript, periodMinutes, env = process.env } = {}) {
  const fullShare = setting(env, 'RECORDING_FULL_SHARE');
  const lateSec = setting(env, 'TRANSCRIPT_LATE_START_SEC');
  const loopSec = setting(env, 'TRANSCRIPT_LOOP_MINUTES') * 60;
  const gapSec = setting(env, 'TRANSCRIPT_GAP_MINUTES') * 60;
  const brokenShare = setting(env, 'TRANSCRIPT_BROKEN_SHARE');

  const period = Number(periodMinutes) > 0 ? Number(periodMinutes) : null;
  const lines = parse(transcript);
  if (!lines.length) {
    return { status: 'broken', coverage: 0, issues: [{ type: 'short', from: '00:00' }], period_minutes: period, first_ts: null, last_ts: null };
  }

  const firstSec = lines[0].sec;
  const lastSec = lines[lines.length - 1].sec;
  const coverage = period ? Math.round((lastSec / 60 / period) * 10000) / 10000 : 1;
  const timed = [];

  if (firstSec > lateSec) timed.push({ at: firstSec, issue: { type: 'late_start', to: clock(firstSec) } });
  for (let k = 1; k < lines.length; k += 1) {
    if (lines[k].sec - lines[k - 1].sec >= gapSec) {
      timed.push({ at: lines[k - 1].sec, issue: { type: 'gap', from: clock(lines[k - 1].sec), to: clock(lines[k].sec) } });
    }
  }
  const looped = loops(lines, loopSec);
  for (const l of looped) timed.push({ at: l.fromSec, issue: { type: 'loop', from: clock(l.fromSec), to: clock(l.toSec) } });
  if (period && coverage < fullShare) timed.push({ at: lastSec, issue: { type: 'short', from: clock(lastSec) } });

  const issues = timed.sort((a, b) => a.at - b.at).map((t) => t.issue);
  const loopMinutes = looped.reduce((sum, l) => sum + (l.toSec - l.fromSec) / 60, 0);
  const span = period || lastSec / 60;
  const status = loopMinutes > brokenShare * span ? 'broken' : issues.length ? 'partial' : 'ok';

  return { status, coverage, issues, period_minutes: period, first_ts: clock(firstSec), last_ts: clock(lastSec) };
}

/** The spec §5.3 `TRANSCRIPT GAPS:` block, one line per issue; '' when there is nothing to say. */
function promptGaps(quality) {
  if (!quality || quality.status === 'ok' || !Array.isArray(quality.issues) || !quality.issues.length) return '';
  const period = quality.period_minutes ? ` of a ${quality.period_minutes}-minute period` : '';
  const say = {
    short: (i) => `no speech after ${i.from}${period}`,
    late_start: (i) => `no speech before ${i.to}`,
    gap: (i) => `no speech from ${i.from} to ${i.to}`,
    loop: (i) => `the same words repeat from ${i.from} to ${i.to} (not real speech)`,
  };
  const lines = quality.issues.filter((i) => say[i.type]).map((i) => `- ${say[i.type](i)}`);
  if (!lines.length) return '';
  return ['TRANSCRIPT GAPS:', ...lines, 'Use "IE" for any indicator whose evidence would fall in these gaps.'].join('\n');
}

/** The three fields that are persisted (`transcript_quality`); nothing else. */
function stored(quality) {
  if (!quality) return null;
  return { status: quality.status, coverage: quality.coverage, issues: (quality.issues || []).map((i) => ({ ...i })) };
}

module.exports = { assess, promptGaps, stored, DEFAULTS };
