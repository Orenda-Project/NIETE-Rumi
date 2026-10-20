/**
 * The "Reading Hour & Numeracy" band on the New-lesson page (DESIGN v2 §0, §1, §2 S2, §7;
 * mockups picker_g1_en / picker_g1_ur).
 *
 * The subject picker above it is a tray (teacher/ui/ClassPicker.tsx differs between main and sandbox, so nothing
 * hooks inside it); the band renders UNDER it with its own grade chips (1–5, ≥48 px, a radiogroup — FLN is for
 * Grades 1–5 only, bd-elc1qz), defaulting to the teacher's grade from their classes (the same `gs:lessons` load as
 * NewLessonPage): the lowest of their Grades 1–5. Whether a teacher sees it at all is `bandGrade` (bd-4tsjcr).
 *
 *   /fln/me off or 404     → null (the page is byte-identical to today)
 *   a teacher, classes read pending → null (no heading that might then disappear), for at most 8 s: a read that
 *                            has not answered by then is a FAILED read → Grade 1, latched (a late answer is ignored)
 *   a teacher whose every known CLASS grade is 6–12 → null for this visit of the page (operator, 20 Oct 2026:
 *                            "not at all"); lesson-plan history never hides it
 *   catalogue 404          → null
 *   loading                → three skeleton rows (reserved height)
 *   503 / 5xx / network    → one calm line + Try again
 *   ok                     → three rows ≥56 px: name + "<count> lessons · Level n" (count from the grade's own
 *                            rows, as the list counts them)
 *
 * The band lives in the teacher app, so its language is the app's (`useLang()`), not /me's.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { flnApi } from './api';
import { FLN_DIR, flnStrings, levelForGrade, type FlnSubjectKey } from './strings';
import type { FlnCatalogue } from './types';
import { FLN_SUBJECTS, listUrl, rowsCount } from './listShared';
import { useLang } from '../teacher/i18n';
import { loadGradeSubjects, type GradeSubject } from '../lib/gradeSubjects';
import { useLoad } from '../newui/lessons/shared';
import './fln.css';

const GRADES = [1, 2, 3, 4, 5];
/** bd-4tsjcr S1 — nothing else times the classes read out (axios client, useLoad, the server's pool): by then it failed. */
const CLASSES_DEADLINE_MS = 8_000;
const ICON: Record<FlnSubjectKey, string> = { 'rh-en': 'Aa', 'rh-ur': 'ا ب', num: '123' };

type MeState = 'pending' | 'on' | 'off';
type CatsState = { k: 'loading' } | { k: 'off' } | { k: 'error' } | { k: 'ok'; cats: FlnCatalogue[] };

/** Their grade: the lowest of their Grades 1–5; none (or only 6–12) → 1. Whether a teacher sees the band: bandGrade. */
export function defaultGrade(grades: Array<number | null | undefined>): number {
  const g = [...new Set(grades.filter((x): x is number => typeof x === 'number' && x >= 1 && x <= 5))].sort((a, b) => a - b);
  return g.length ? g[0] : 1;
}

/** A grade we know: an integer 1–12. Early years (null) and anything else say nothing about what they teach. */
const knownGrade = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 12;

/**
 * bd-4tsjcr — where the band opens, or null when it is not shown at all. The operator, 20 Oct 2026, on a teacher
 * whose classes are all Grades 6–12: "not at all".
 *
 *   `grades`  the grades of their CLASSES (never lesson-plan history: see bandGradeForPairs), or null when that
 *             read FAILED
 *   leader                                   → shown, on defaultGrade (unchanged: their lowest Grade 1–5, else 1)
 *   failed read / no classes / only unknown  → Grade 1: we cannot tell what they teach, so nothing is hidden
 *   any known Grade 1–5                      → the lowest of them
 *   every known grade above 5                → null (no band)
 */
export function bandGrade(grades: Array<number | null | undefined> | null, leader: boolean): number | null {
  if (leader || grades == null) return defaultGrade(grades ?? []);
  const known = grades.filter(knownGrade);
  if (known.length > 0 && known.every((g) => g > 5)) return null;
  return defaultGrade(known);
}

/**
 * bd-4tsjcr red team B1 — bandGrade over the classes read as GET /me/grade-subjects answers it: ALL their class pairs
 * or, only when there is no class pair at all (no classes, or classes with no subjects), their lesson-plan HISTORY
 * pairs (dashboard grade-subjects.service). History says what they opened, not what they teach, so it never hides the
 * band: its lowest Grade 1–5, else Grade 1, the default before bd-4tsjcr.
 *
 *   `pairs`  the read's answer, or null when it FAILED or did not answer within CLASSES_DEADLINE_MS
 */
export function bandGradeForPairs(pairs: Array<Pick<GradeSubject, 'grade' | 'source'>> | null, leader: boolean): number | null {
  if (pairs == null) return bandGrade(null, leader);
  const fromClasses = pairs.filter((p) => p.source === 'class');
  if (fromClasses.length > 0 || pairs.length === 0) return bandGrade(fromClasses.map((p) => p.grade), leader);
  return defaultGrade(pairs.map((p) => p.grade));
}

/** The band's body: loaded lazily by `FlnBand` only after /fln/me says lessons are on. */
export function FlnBandBody({ leader = false }: { leader?: boolean } = {}) {
  const lang = useLang();
  const s = flnStrings(lang);
  const rtl = FLN_DIR[lang] === 'rtl';
  const me: MeState = 'on';
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const [picked, setPicked] = useState<number | null>(null);
  const [cats, setCats] = useState<CatsState>({ k: 'loading' });
  const [attempt, setAttempt] = useState(0);


  const combosDone = combos.status === 'ok' || combos.status === 'error';
  // A teacher's classes read that has not answered within CLASSES_DEADLINE_MS is a failed read (Grade 1). Latched:
  // once late, an answer that lands afterwards is ignored, so a band once shown never disappears. A leader is not
  // timed: their band shows while the read is pending (unchanged).
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (leader || combosDone || late) return undefined;
    const t = setTimeout(() => setLate(true), CLASSES_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [leader, combosDone, late]);
  // undefined = their classes are still being read; null = no band for them; a number = the grade it opens on.
  const mine = useMemo<number | null | undefined>(() => {
    if (late) return bandGradeForPairs(null, leader);
    if (combos.status === 'ok') return bandGradeForPairs(combos.data, leader);
    if (combos.status === 'error') return bandGradeForPairs(null, leader);
    return undefined;
  }, [combos, leader, late]);
  const decided = combosDone || late;
  const hidden = !leader && (!decided || mine === null);
  const grade = hidden ? null : picked ?? (decided ? (mine ?? null) : null);

  // The selected chip in the middle of its row (red-team 192944: a G5+ teacher's chip sat off-screen in the RTL
  // scroller). Moves the row only, never the page; a scrollLeft delta works for LTR and RTL alike.
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('.fln-chip.on');
    if (!row || !chip) return;
    const r = row.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    row.scrollLeft += (c.left + c.width / 2) - (r.left + r.width / 2);
  }, [grade]);

  useEffect(() => {
    if (me !== 'on' || grade == null) return undefined;
    let live = true;
    setCats({ k: 'loading' });
    Promise.all(FLN_SUBJECTS.map((subject) => flnApi.catalogue({ grade, subject }))).then(
      (all) => { if (live) setCats(all.some((c) => !c) ? { k: 'off' } : { k: 'ok', cats: all as FlnCatalogue[] }); },
      () => { if (live) setCats({ k: 'error' }); },
    );
    return () => { live = false; };
  }, [me, grade, attempt]);

  if (me !== 'on' || hidden || cats.k === 'off') return null;

  const sub = (c: FlnCatalogue): string => {
    const level = c.level ?? (grade == null ? null : levelForGrade(grade)) ?? 1;
    // The grade's own rows (as the list counts them), never the level's representative grade (QT-counts).
    return s.bandRow(rowsCount(c, level), level);
  };

  return (
    <section className="fln-band" lang={lang} dir={FLN_DIR[lang]} aria-labelledby="fln-band-title">
      <h2 id="fln-band-title" className="fln-band-title">
        <span aria-hidden="true">★ </span>
        <span>{s.band.title}</span>
      </h2>
      <p className="fln-band-sub">{s.band.sub}</p>

      <div ref={chipsRef} className="fln-chips" role="radiogroup" aria-label={s.band.gradeLabel}>
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={g === grade}
            className={`fln-chip${g === grade ? ' on' : ''}`}
            onClick={() => setPicked(g)}
          >
            {s.grade(g)}
          </button>
        ))}
      </div>

      {cats.k === 'error' && (
        <p className="fln-band-error">
          <span>{s.band.error}</span>{' '}
          <button type="button" className="fln-link-btn" onClick={() => setAttempt((n) => n + 1)}>{s.band.retry}</button>
        </p>
      )}

      {(cats.k === 'loading' || grade == null) && cats.k !== 'error' && (
        <div className="fln-fl" aria-busy="true">
          <span className="fln-sr">{s.band.loading}</span>
          {FLN_SUBJECTS.map((k) => <div key={k} className="fln-row fln-skel fln-skel-band" data-fln-skeleton="band" />)}
        </div>
      )}

      {cats.k === 'ok' && grade != null && (
        <div className="fln-fl">
          {FLN_SUBJECTS.map((subject, i) => (
            <Link key={subject} to={listUrl(subject, grade)} className={`fln-row fln-c-${subject}`}>
              <span className={`fln-ic${subject === 'rh-ur' ? ' fln-ic-u' : ''}`} dir={subject === 'rh-ur' ? 'rtl' : 'ltr'} aria-hidden="true">{ICON[subject]}</span>
              <span className="fln-row-body">
                <b>{s.subject[subject]}</b>
                <small>{sub(cats.cats[i])}</small>
              </span>
              <span className="fln-go" aria-hidden="true">{rtl ? '‹' : '›'}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default FlnBandBody;
