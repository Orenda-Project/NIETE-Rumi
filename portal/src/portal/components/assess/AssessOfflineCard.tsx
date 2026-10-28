import { useEffect, useMemo, useState } from 'react';
import { CloudDownload } from 'lucide-react';
import { childTestSa } from '../../services/api';
import { readVisit, visitKey, writeVisit } from '../../lib/assess/visitStore';
import type { SaSchool } from '../../types/childTestSa';
import { OFFLINE_COPY } from './offlineCopy';
import {
  checkForms, formsFor, keepPageOffline, listUrl, mb, prepForms, readPrep, today, writePrep, writePreparedList, type Lang, type PrepRecord, type Progress,
} from './offlineReady';

/**
 * "Get ready for offline" (switch sa_r8_offline_prep), on the schools screen. While online, the coach picks schools
 * (today's visits ticked) and taps Get ready: each school's list is read now and kept on the phone (today's visit
 * memory and a prepared copy), then every battery those lists need, in both languages, goes on the phone through the
 * engine's worker. Arriving at a school with no signal, the coach opens the school, picks a child and runs the test.
 * The card says how much came down and when; a record from an earlier day says to get ready again. The page itself is
 * kept too (public/assess-sw.js), so a tab the phone reloads at the school still opens.
 */

const SHOW_ALL_UP_TO = 15;
const ALL_GRADES = [1, 2, 3, 4, 5];

type Props = { schools: SaSchool[]; lang: Lang; allGrades: boolean };

export default function AssessOfflineCard({ schools, lang, allGrades }: Props) {
  const c = OFFLINE_COPY[lang];
  const [record, setRecord] = useState<PrepRecord | null>(readPrep);
  const [still, setStill] = useState<boolean | null>(null);
  const shown = useMemo(() => {
    const kept = new Set((record?.schools || []).map((s) => s.schoolId));
    const some = schools.filter((s) => s.visitToday || kept.has(s.schoolId));
    return schools.length <= SHOW_ALL_UP_TO ? schools : some.length ? some : schools.slice(0, SHOW_ALL_UP_TO);
  }, [schools, record]);
  const [picked, setPicked] = useState<Set<string>>(() => {
    const kept = (readPrep()?.schools || []).map((s) => s.schoolId);
    const todays = schools.filter((s) => s.visitToday).map((s) => s.schoolId);
    return new Set(todays.length ? todays : kept);
  });
  // sa_all_grades: the grades the coach will test at each school (the list is drawn per grade); the school's observed
  // grade is ticked to start with
  const [gradesAt, setGradesAt] = useState<Record<string, number[]>>(() => Object.fromEntries(
    schools.map((s) => [s.schoolId, s.observedGrade ? [s.observedGrade] : []])));
  const [noGrade, setNoGrade] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [nothing, setNothing] = useState(false);

  // a record on the phone: are its files still there (the browser may clear them)?
  useEffect(() => {
    if (!record || !record.forms.length) return undefined;
    let live = true;
    checkForms(record.forms).then((r) => { if (live) setStill(r.ready); });
    return () => { live = false; };
  }, [record]);

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const toggleGrade = (id: string, g: number) => setGradesAt((m) => {
    const had = m[id] || [];
    return { ...m, [id]: had.includes(g) ? had.filter((x) => x !== g) : [...had, g].sort() };
  });
  const needsGrades = (s: SaSchool) => allGrades && !s.grade;

  const getReady = async () => {
    const chosen = schools.filter((s) => picked.has(s.schoolId));
    if (!chosen.length) { setNothing(true); return; }
    setNothing(false);
    const missingGrade = chosen.find((s) => needsGrades(s) && !(gradesAt[s.schoolId] || []).length);
    if (missingGrade) { setNoGrade(missingGrade.name); return; }
    setNoGrade(null);
    setProgress({ done: 0, total: 0, bytes: 0 });
    const grades = new Set<number>();
    const done: PrepRecord['schools'] = [];
    const lists: string[] = [];
    // one list: the school's (grade = the school's own, or a grade the coach ticked under sa_all_grades)
    const prepList = async (s: SaSchool, grade: number | undefined) => {
      try {
        const out = grade ? await childTestSa.getList(s.schoolId, s.visitId, grade) : await childTestSa.getList(s.schoolId, s.visitId);
        const l = out.list;
        lists.push(listUrl(s.schoolId, s.visitId, grade));
        writePreparedList(s.schoolId, grade, l);
        const key = visitKey(s.schoolId, undefined, grade);
        writeVisit(key, { ...readVisit(key), list: l });
        grades.add(l.grade);
        l.children.concat(l.alternates || []).forEach((k) => { if (k.grade) grades.add(k.grade); });
        done.push({ schoolId: s.schoolId, name: s.name, grade: grade ?? l.grade, listed: true });
      } catch {
        const g = grade ?? s.observedGrade ?? null;
        if (g) grades.add(g);
        done.push({ schoolId: s.schoolId, name: s.name, grade: g, listed: false });
      }
    };
    for (const s of chosen) {
      if (needsGrades(s)) { for (const g of gradesAt[s.schoolId] || []) await prepList(s, g); }
      else await prepList(s, s.grade);
    }
    const forms = formsFor([...grades].sort());
    const page = keepPageOffline(lists);
    const r = await prepForms(forms, (p) => setProgress(p));
    await page;
    const rec: PrepRecord = { at: Date.now(), day: today(), schools: done, forms, ok: r.ok && done.every((d) => d.listed), total: r.total, cached: r.cached, bytes: r.bytes };
    writePrep(rec);
    setRecord(rec);
    setStill(r.ok);
    setProgress(null);
  };

  const when = record ? new Date(record.at).toLocaleTimeString(lang === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const missing = record ? record.total - record.cached : 0;

  return (
    <section data-testid="assess-offline-card" className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900"><CloudDownload className="h-5 w-5 shrink-0" aria-hidden /> {c.prepTitle}</h2>
      <p className="text-sm text-slate-700">{c.prepBody}</p>
      {record && !progress && (
        <div className="space-y-1">
          {missing === 0 && still !== false
            ? <p data-testid="assess-offline-ready" role="status" className="font-medium text-emerald-800">{c.ready(record.schools.length, mb(record.bytes), when)}</p>
            : <p data-testid="assess-offline-partly" role="alert" className="text-sm text-amber-900">{c.partly(Math.max(missing, 1))}</p>}
          {record.schools.filter((s) => !s.listed).map((s) => (
            <p key={`${s.schoolId}:${s.grade}`} className="text-sm text-amber-900">{c.noList(s.name)}</p>
          ))}
          {record.day !== today() && <p data-testid="assess-offline-earlier" className="text-sm text-amber-900">{c.earlierDay}</p>}
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-800">{c.prepSchools}</legend>
        {shown.map((s) => (
          <div key={s.schoolId} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <label className="flex min-h-[48px] items-center gap-3">
              <input type="checkbox" className="h-6 w-6 shrink-0" checked={picked.has(s.schoolId)} disabled={!!progress}
                data-testid={`assess-offline-school-${s.schoolId}`} onChange={() => toggle(s.schoolId)} />
              <span className="min-w-0 flex-1 break-words text-slate-900">{s.name || '—'}</span>
            </label>
            {needsGrades(s) && picked.has(s.schoolId) && (
              <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-label={c.gradesLabel}>
                <span className="text-sm text-slate-700">{c.gradesLabel}</span>
                {ALL_GRADES.map((g) => {
                  const on = (gradesAt[s.schoolId] || []).includes(g);
                  return (
                    <button key={g} type="button" aria-pressed={on} disabled={!!progress} onClick={() => toggleGrade(s.schoolId, g)}
                      data-testid={`assess-offline-grade-${s.schoolId}-${g}`}
                      className={`min-h-[44px] min-w-[44px] rounded-xl border text-base ${on ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-900'}`}>{g}</button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {nothing && <p role="alert" className="text-sm text-amber-900">{c.noSchools}</p>}
      {noGrade && <p role="alert" data-testid="assess-offline-no-grade" className="text-sm text-amber-900">{c.pickGrades(noGrade)}</p>}
      {progress ? (
        <div data-testid="assess-offline-progress" role="status" className="space-y-1">
          <p className="text-sm text-slate-800">{c.working(progress.done, progress.total)}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-sky-100">
            <div className="h-2 bg-sky-600" style={{ width: `${progress.total ? Math.round((100 * progress.done) / progress.total) : 0}%` }} />
          </div>
        </div>
      ) : (
        <button type="button" data-testid="assess-offline-go" onClick={getReady}
          className="w-full min-h-[56px] rounded-2xl bg-sky-700 text-lg font-semibold text-white">{record ? c.prepAgain : c.prepButton}</button>
      )}
    </section>
  );
}
