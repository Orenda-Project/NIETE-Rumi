/**
 * bd-t7zk3t.11 — the "Reading Hour & Numeracy" band on the New-lesson page (DESIGN v2 §0, §1, §2 S2, §7;
 * mockups picker_g1_en / picker_g1_ur / picker_g8_en).
 *
 * The subject picker above it is a tray (teacher/ui/ClassPicker.tsx differs between main and sandbox, so nothing
 * hooks inside it); the band renders UNDER it with its own grade chips (1–12, ≥48 px, a radiogroup), defaulting to
 * the teacher's grade from her classes (the same `gs:lessons` load as NewLessonPage): exactly one grade → it,
 * several → the lowest, none → grade 1.
 *
 *   /fln/me off or 404     → null (the page is byte-identical to today)
 *   catalogue 404          → null
 *   loading                → three skeleton rows (reserved height)
 *   503 / 5xx / network    → one calm line + Try again
 *   ok                     → three rows ≥56 px: name + "<count> lessons · Level n" (grade 1–5, count from the
 *                            level's placement count) or "By level · start with the screener" (6–12, never minutes)
 *
 * The band lives in the teacher app, so its language is the app's (`useLang()`), not /me's.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { flnApi } from './api';
import { FLN_DIR, flnStrings, levelForGrade, type FlnSubjectKey } from './strings';
import type { FlnCatalogue } from './types';
import { FLN_SUBJECTS, listUrl } from './listShared';
import { useLang } from '../teacher/i18n';
import { loadGradeSubjects } from '../lib/gradeSubjects';
import { dataOf, useLoad } from '../newui/lessons/shared';
import './fln.css';

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ICON: Record<FlnSubjectKey, string> = { 'rh-en': 'Aa', 'rh-ur': 'ا ب', num: '123' };

type MeState = 'pending' | 'on' | 'off';
type CatsState = { k: 'loading' } | { k: 'off' } | { k: 'error' } | { k: 'ok'; cats: FlnCatalogue[] };

/** Her grade: exactly one → it; several → the lowest; none → 1. */
export function defaultGrade(grades: Array<number | null | undefined>): number {
  const g = [...new Set(grades.filter((x): x is number => typeof x === 'number' && x >= 1 && x <= 12))].sort((a, b) => a - b);
  return g.length ? g[0] : 1;
}

export function FlnBand() {
  const lang = useLang();
  const s = flnStrings(lang);
  const rtl = FLN_DIR[lang] === 'rtl';
  const [me, setMe] = useState<MeState>('pending');
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const [picked, setPicked] = useState<number | null>(null);
  const [cats, setCats] = useState<CatsState>({ k: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    flnApi.me().then(
      (m) => { if (live) setMe(m && m.lessons ? 'on' : 'off'); },
      () => { if (live) setMe('off'); },
    );
    return () => { live = false; };
  }, []);

  const combosDone = combos.status === 'ok' || combos.status === 'error';
  const mine = useMemo(() => defaultGrade((dataOf(combos) ?? []).map((c) => c.grade)), [combos]);
  const grade = picked ?? (combosDone ? mine : null);

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

  if (me !== 'on' || cats.k === 'off') return null;

  const sub = (c: FlnCatalogue): string => {
    if (grade == null || grade >= 6) return s.band.subSenior;
    const level = c.level ?? levelForGrade(grade) ?? 1;
    const count = c.levels.find((l) => l.level === level)?.count ?? 0;
    return s.bandRow(count, level);
  };

  return (
    <section className="fln-band" lang={lang} dir={FLN_DIR[lang]} aria-labelledby="fln-band-title">
      <h2 id="fln-band-title" className="fln-band-title">
        <span aria-hidden="true">★ </span>
        <span>{s.band.title}</span>
      </h2>
      <p className="fln-band-sub">{s.band.sub}</p>

      <div className="fln-chips" role="radiogroup" aria-label={s.band.gradeLabel}>
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

export default FlnBand;
