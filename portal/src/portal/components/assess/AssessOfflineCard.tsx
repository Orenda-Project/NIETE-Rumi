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

  const getReady = async () => {
    const chosen = schools.filter((s) => picked.has(s.schoolId));
    if (!chosen.length) { setNothing(true); return; }
    setNothing(false);
    setProgress({ done: 0, total: 0, bytes: 0 });
    const grades = new Set<number>();
    const done: PrepRecord['schools'] = [];
    const lists: string[] = [];
    for (const s of chosen) {
      // sa_all_grades: the grade is named at the school, so every grade's test goes on the phone and the list waits
      if (allGrades && !s.grade) {
        ALL_GRADES.forEach((g) => grades.add(g));
        done.push({ schoolId: s.schoolId, name: s.name, grade: null, listed: false });
        continue;
      }
      try {
        const out = s.grade ? await childTestSa.getList(s.schoolId, s.visitId, s.grade) : await childTestSa.getList(s.schoolId, s.visitId);
        const l = out.list;
        lists.push(listUrl(s.schoolId, s.visitId, s.grade));
        writePreparedList(s.schoolId, s.grade, l);
        const key = visitKey(s.schoolId, undefined, s.grade);
        writeVisit(key, { ...readVisit(key), list: l });
        grades.add(l.grade);
        l.children.concat(l.alternates || []).forEach((k) => { if (k.grade) grades.add(k.grade); });
        done.push({ schoolId: s.schoolId, name: s.name, grade: s.grade ?? l.grade, listed: true });
      } catch {
        if (s.grade) grades.add(s.grade); else if (s.observedGrade) grades.add(s.observedGrade);
        done.push({ schoolId: s.schoolId, name: s.name, grade: s.grade ?? s.observedGrade ?? null, listed: false });
      }
    }
    const forms = formsFor([...grades].sort());
    const page = keepPageOffline(lists);
    const r = await prepForms(forms, (p) => setProgress(p));
    await page;
    const rec: PrepRecord = { at: Date.now(), day: today(), schools: done, forms, ok: r.ok && done.every((d) => d.listed || allGrades), total: r.total, cached: r.cached, bytes: r.bytes };
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
          {record.schools.filter((s) => !s.listed && !(allGrades && s.grade === null)).map((s) => (
            <p key={s.schoolId} className="text-sm text-amber-900">{c.noList(s.name)}</p>
          ))}
          {record.day !== today() && <p data-testid="assess-offline-earlier" className="text-sm text-amber-900">{c.earlierDay}</p>}
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-800">{c.prepSchools}</legend>
        {shown.map((s) => (
          <label key={s.schoolId} className="flex min-h-[48px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <input type="checkbox" className="h-6 w-6 shrink-0" checked={picked.has(s.schoolId)} disabled={!!progress}
              data-testid={`assess-offline-school-${s.schoolId}`} onChange={() => toggle(s.schoolId)} />
            <span className="min-w-0 flex-1 break-words text-slate-900">{s.name || '—'}</span>
          </label>
        ))}
      </fieldset>
      {nothing && <p role="alert" className="text-sm text-amber-900">{c.noSchools}</p>}
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
