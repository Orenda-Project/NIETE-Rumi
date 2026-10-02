import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import BottomSheet from '../components/coaching/BottomSheet';
import { leader } from '../services/api';
import type { DraftOption, DraftSection, ObservationDraft } from '../services/api';

/**
 * bd-5rz1v.6 — "Check the draft report": the WhatsApp review form, in the portal.
 *
 * The same parts in the same order (the form's screens: B, C, D, F), the same
 * fields, pre-filled with the same values — and the same keys submitted, so the
 * bot saves it through the very function the form's last screen calls:
 *
 *   each indicator   r_<id> rating (or N/A) · ev_<id> what was seen · imp_<id> to improve
 *   her lesson plan  fid_r_<k> each move's verdict · fid_e_<k> what was seen
 *
 * Every field is sent, changed or not, exactly as the form sends its init values.
 */

const COPY = {
  title: (name: string) => `${name}’s draft report`,
  part: (n: number, total: number) => `Part ${n} of ${total}`,
  seen: 'What was seen',
  improve: 'To improve',
  moveOf: (k: number, n: number) => `Move ${k} of ${n} · from the lesson plan`,
  changedFrom: (was: string) => `Your Digital Coach said ${was} — you changed it`,
  youChanged: 'You changed this',
  back: 'Back',
  next: 'Next part',
  save: 'Save the draft',
  saveQ: 'Save the draft?',
  changes: (r: number, t: number) => (r + t === 0
    ? 'You did not change anything. The report will use the draft as it is.'
    : `You changed ${r} rating${r === 1 ? '' : 's'} and ${t} note${t === 1 ? '' : 's'}. The report will use your answers.`),
  saveContinue: 'Save and continue',
  keepChecking: 'Keep checking',
  saving: 'Saving…',
  saveFailed: 'The draft did not save. Please try again.',
  notReady: 'This draft cannot be changed any more.',
  loadFailed: 'We could not load the draft. Please try again.',
};

type Values = Record<string, string>;

/** The values the form starts from: one key per field it submits. */
export function initialValues(draft: ObservationDraft): Values {
  const v: Values = {};
  for (const s of draft.sections) {
    if (s.kind === 'moves') {
      for (const m of s.moves) { v[`fid_r_${m.k}`] = m.verdict; v[`fid_e_${m.k}`] = m.evidence || ''; }
    } else {
      for (const ind of s.indicators) {
        v[`r_${ind.field}`] = ind.rating ?? '';
        v[`ev_${ind.field}`] = ind.evidence ?? '';
        v[`imp_${ind.field}`] = ind.improvement ?? '';
      }
    }
  }
  return v;
}

export function countChanges(start: Values, now: Values): { ratings: number; notes: number } {
  let ratings = 0;
  let notes = 0;
  for (const k of Object.keys(now)) {
    if (now[k] === start[k]) continue;
    if (/^(r|fid_r)_/.test(k)) ratings += 1; else notes += 1;
  }
  return { ratings, notes };
}

const Choices = ({ options, value, onChange, label }: { options: DraftOption[]; value: string; onChange: (v: string) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
    {options.map((o) => {
      const on = o.id === value;
      return (
        <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
          className={`min-h-[40px] rounded-[10px] border-2 px-2.5 text-left text-[14px] font-bold ${on ? 'border-primary bg-primary text-white' : 'border-[#c4c8cf] bg-white text-primary'}`}>
          {o.title}
        </button>
      );
    })}
  </div>
);

const Field = ({ label, value, onChange, edited, id }: { label: string; value: string; onChange: (v: string) => void; edited: boolean; id: string }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="flex justify-between text-[13px] font-bold text-[#5b6170]">
      <span>{label}</span>
      {edited && <span className="text-[#1b6b43]">{COPY.youChanged}</span>}
    </label>
    <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} dir="auto"
      className={`w-full rounded-[10px] bg-white p-2.5 text-[15px] leading-snug ${edited ? 'border-2 border-accent' : 'border border-[#d6d9de]'}`} />
  </div>
);

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

const LeaderObserveDraft = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [part, setPart] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    leader.getObservationDraft(id)
      .then((d) => {
        if (!live) return;
        const v = initialValues(d);
        setDraft(d); setStart(v); setValues(v);
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (live) setProblem(status === 409 ? COPY.notReady : COPY.loadFailed);
      });
    leader.getObservation(id)
      .then((v) => { if (live) setName((v.teacher && v.teacher.name) || v.report.teacherName || ''); })
      .catch(() => {});
    return () => { live = false; };
  }, [id]);

  const changes = useMemo(() => countChanges(start, values), [start, values]);
  const set = (k: string) => (v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const titleOf = (opts: DraftOption[], v: string | undefined) => (opts.find((o) => o.id === v) || { title: v || '—' }).title;

  const save = async () => {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await leader.saveObservationDraft(id, values);
      navigate(`/portal/leader/observe/${id}`);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setSaveError(status === 409 ? COPY.notReady : COPY.saveFailed);
      setSaving(false);
      setConfirm(false);
    }
  };

  const first = (name || '').trim().split(/\s+/)[0] || 'The teacher';
  if (problem) {
    return <PortalLayout><div className="mx-auto max-w-md py-10"><Warning>{problem}</Warning></div></PortalLayout>;
  }
  if (!draft) return <PortalLayout><LoadingState type="full" /></PortalLayout>;

  const sections = draft.sections;
  const total = sections.length;
  const s: DraftSection = sections[Math.min(part, total - 1)];
  const last = part >= total - 1;

  return (
    <PortalLayout>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pb-32">
        <div className="flex h-12 items-center gap-1">
          <button type="button" onClick={() => (part > 0 ? setPart(part - 1) : navigate(`/portal/leader/observe/${id}`))} aria-label={COPY.back}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-bold text-primary" dir="auto">{COPY.title(first)}</h1>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5" aria-hidden="true">
            {sections.map((x, i) => (
              <span key={x.key} className={`h-2 rounded ${i === part ? 'w-6 bg-primary' : 'w-2 bg-[#c4c8cf]'}`} />
            ))}
          </div>
          <span className="text-[13px] font-bold text-[#5b6170]">{COPY.part(part + 1, total).toUpperCase()}</span>
          <h2 className="text-[20px] font-bold">{s.letter}. {s.title}</h2>
        </div>

        {s.kind === 'moves' && (
          <>
            {s.header && <p className="whitespace-pre-line rounded-xl bg-[#e3f4ea] p-3 text-[14px] leading-relaxed text-[#1b4d35]">{s.header}</p>}
            {s.moves.length === 0 && s.fallback && <p className="rounded-xl bg-white p-3 text-[15px] leading-relaxed">{s.fallback}</p>}
            {s.moves.map((m) => {
              const rk = `fid_r_${m.k}`;
              const ek = `fid_e_${m.k}`;
              const changed = values[rk] !== start[rk];
              return (
                <div key={m.k} className={`flex flex-col gap-2 rounded-[14px] bg-white p-3 ${changed || values[ek] !== start[ek] ? 'border-2 border-accent' : 'border border-[#e5e7eb]'}`}>
                  <span className="text-[12px] font-bold text-[#5b6170]">{COPY.moveOf(m.k, s.moves.length).toUpperCase()}</span>
                  <p className="whitespace-pre-line text-[15px] font-semibold leading-snug" dir="auto">{m.plan}</p>
                  <Choices options={draft.fidelityScale} value={values[rk]} onChange={set(rk)} label={`Move ${m.k}`} />
                  {changed && <span className="text-[12px] font-bold text-[#1b6b43]">{COPY.changedFrom(titleOf(draft.fidelityScale, start[rk]))}</span>}
                  <Field id={ek} label={COPY.seen} value={values[ek] ?? ''} onChange={set(ek)} edited={values[ek] !== start[ek]} />
                </div>
              );
            })}
          </>
        )}

        {s.kind === 'indicators' && (
          <>
            {s.notes.map((n) => <p key={n.slice(0, 40)} className="whitespace-pre-line rounded-xl bg-[#e3f4ea] p-3 text-[14px] leading-relaxed text-[#1b4d35]">{n}</p>)}
            {s.indicators.map((ind) => {
              const rk = `r_${ind.field}`;
              const ek = `ev_${ind.field}`;
              const ik = `imp_${ind.field}`;
              const changed = values[rk] !== start[rk];
              return (
                <div key={ind.id} className={`flex flex-col gap-2 rounded-[14px] bg-white p-3 ${changed ? 'border-2 border-accent' : 'border border-[#e5e7eb]'}`}>
                  <span className="text-[16px] font-bold" dir="auto">{ind.id} · {ind.name}</span>
                  <Choices options={draft.scale} value={values[rk]} onChange={set(rk)} label={`${ind.id} ${ind.name}`} />
                  {changed && <span className="text-[12px] font-bold text-[#1b6b43]">{COPY.changedFrom(titleOf(draft.scale, start[rk]))}</span>}
                  <Field id={ek} label={COPY.seen} value={values[ek] ?? ''} onChange={set(ek)} edited={values[ek] !== start[ek]} />
                  <Field id={ik} label={COPY.improve} value={values[ik] ?? ''} onChange={set(ik)} edited={values[ik] !== start[ik]} />
                </div>
              );
            })}
          </>
        )}

        {saveError && <Warning>{saveError}</Warning>}
      </div>

      {/* Above the leader bottom nav on a phone (fixed, h-16, z-50 — PortalNavigation):
          at bottom-0 it sat UNDER the nav and Next part could not be tapped. */}
      <div data-testid="draft-actions"
        className="fixed inset-x-0 bottom-16 md:bottom-0 z-40 border-t border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(29,33,41,0.08)]">
        <div className="mx-auto flex max-w-md gap-2.5">
          <button type="button" onClick={() => (part > 0 ? setPart(part - 1) : navigate(`/portal/leader/observe/${id}`))}
            className="h-[52px] flex-1 rounded-[14px] border-2 border-primary bg-white text-[17px] font-bold text-primary">{COPY.back}</button>
          {last ? (
            <button type="button" onClick={() => setConfirm(true)} className="h-[52px] flex-[2] rounded-[14px] bg-primary text-[17px] font-bold text-white">{COPY.save}</button>
          ) : (
            <button type="button" onClick={() => { setPart(part + 1); try { window.scrollTo(0, 0); } catch { /* no window to scroll */ } }}
              className="h-[52px] flex-[2] rounded-[14px] bg-primary text-[17px] font-bold text-white">{COPY.next}</button>
          )}
        </div>
      </div>

      {confirm && (
        <BottomSheet label={COPY.saveQ} onClose={saving ? undefined : () => setConfirm(false)}>
          <div className="text-[22px] font-bold">{COPY.saveQ}</div>
          <div className="text-[16px] leading-relaxed text-[#3a3f4b]">{COPY.changes(changes.ratings, changes.notes)}</div>
          <button type="button" onClick={save} disabled={saving}
            className="flex h-14 items-center justify-center gap-2 rounded-[14px] bg-primary text-[18px] font-bold text-white disabled:opacity-60">
            {saving && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />}{saving ? COPY.saving : COPY.saveContinue}
          </button>
          <button type="button" onClick={() => setConfirm(false)} disabled={saving}
            className="h-12 rounded-xl border border-[#d6d9de] bg-white text-[16px] font-semibold text-[#5b6170]">{COPY.keepChecking}</button>
        </BottomSheet>
      )}
    </PortalLayout>
  );
};

export default LeaderObserveDraft;
