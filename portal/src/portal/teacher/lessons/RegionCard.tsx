import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { CARD, FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';

/**
 * bd-rj6w0n.14.2 — the one-time ICT-or-GB choice, on the Lesson Plans page she already opens. Never a WhatsApp
 * question: every message costs money, and most teachers are already known (the GB roster, users.region, her school).
 *
 * GET /teacher/region says whether to ask (dashboard/routes/portal-teacher-region.routes.js, dark unless
 * LP_GB_K5_ENABLED). Only when ask is true does anything show: two choices, and for GB her school from the GB list
 * (or Not listed). Save posts once and the card goes, whatever the answer; a failed read shows nothing.
 */

type School = { id: string; name: string };
type Choice = 'ict' | 'gb';

async function loadAsk(): Promise<School[] | null> {
  try {
    const { data } = await api.get('/teacher/region');
    if (!data || data.ask !== true) return null;
    return Array.isArray(data.schools)
      ? data.schools.filter((s: School) => s && typeof s.id === 'string' && typeof s.name === 'string')
      : [];
  } catch {
    return null;
  }
}

export function RegionCard() {
  const C = useCopy(LESSONS).region;
  const [schools, setSchools] = useState<School[] | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [schoolId, setSchoolId] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    void loadAsk().then((s) => { if (live) setSchools(s); });
    return () => { live = false; };
  }, []);

  if (done || !schools) return null;

  const save = () => {
    if (!choice) return;
    const body = choice === 'gb' && schoolId ? { region: choice, schoolId } : { region: choice };
    setDone(true);
    try {
      void Promise.resolve(api.post('/teacher/region', body)).catch(() => {});
    } catch { /* a save never fails for her */ }
  };

  const option = (value: Choice, label: string) => (
    <button
      type="button"
      aria-pressed={choice === value}
      onClick={() => setChoice(value)}
      className={cn(
        'min-h-[48px] flex-1 rounded-xl border px-3 text-[16px] font-semibold',
        choice === value ? 'border-[#0f766e] bg-[#ccfbf1] text-[#134e4a]' : 'border-[#d1d5db] bg-white text-[#111827]',
        FOCUS,
      )}
    >
      {label}
    </button>
  );

  return (
    <section aria-label={C.title} className={cn('mt-3 flex flex-col gap-3 p-4', CARD)}>
      <h2 className="text-[18px] font-semibold">{C.title}</h2>
      <div className="flex gap-2">
        {option('ict', C.ict)}
        {option('gb', C.gb)}
      </div>
      {choice === 'gb' && (
        <label className="flex flex-col gap-1 text-[14px]">
          {C.school}
          <select
            aria-label={C.school}
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            className={cn('min-h-[48px] rounded-xl border border-[#d1d5db] bg-white px-3 text-[16px]', FOCUS)}
          >
            <option value="">{C.notListed}</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={!choice}
        onClick={save}
        className={cn('min-h-[48px] rounded-xl bg-[#0f766e] px-4 text-[16px] font-semibold text-white disabled:opacity-40', FOCUS)}
      >
        {C.save}
      </button>
    </section>
  );
}
