/**
 * bd-t7zk3t.12 — the leader's own teachers (GET /api/portal/fln/teachers?q=, PR-E): search, multi-select up to 30.
 * Only a keyed id, the name and the school are ever read off a row — a phone number is never drawn, even if a server
 * sent one. 404 = sending is not deployed here (the sheet offers Share link instead).
 */
import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../teacher/ui/styles';
import { shareApi, type Teacher } from './api';
import { Fill } from './Fill';
import { MAX_RECIPIENTS, shareStrings, type ShareLang } from './strings.share';

export type PickerState = 'loading' | 'ready' | 'empty' | 'unavailable' | 'failed';

export default function TeacherPicker({ lang, selected, onChange, onState }: {
  lang: ShareLang;
  selected: string[];
  onChange: (keys: string[]) => void;
  onState?: (s: PickerState) => void;
}) {
  const S = shareStrings(lang);
  const [q, setQ] = useState('');
  const [state, setState] = useState<PickerState>('loading');
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attempt, setAttempt] = useState(0);
  // The first answer with no search decides "no teachers assigned" — a search with no hit is a different line.
  const [everAny, setEverAny] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void shareApi.teachers(q.trim()).then((r) => {
        if (!alive) return;
        if (!r.ok) {
          setState(r.status === 404 ? 'unavailable' : 'failed');
          return;
        }
        const rows = (Array.isArray(r.data.teachers) ? r.data.teachers : [])
          .filter((x) => x && typeof x.key === 'string' && typeof x.name === 'string')
          .map((x) => ({ key: x.key, name: x.name, school: typeof x.school === 'string' ? x.school : null }));
        setTeachers(rows);
        if (!q.trim()) setEverAny(rows.length > 0);
        setState(rows.length ? 'ready' : 'empty');
      });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, attempt]);

  useEffect(() => { onState?.(state); }, [state, onState]);

  if (state === 'unavailable') return null;

  const full = selected.length >= MAX_RECIPIENTS;
  const toggle = (key: string) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else if (!full) onChange([...selected, key]);
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[16px] font-bold">{S.chooseTeachers}</h3>
      <label className="relative block">
        <span className="sr-only">{S.searchTeachers}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6b7280]" aria-hidden="true" />
        <input
          type="search"
          aria-label={S.searchTeachers}
          placeholder={S.searchTeachers}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn('min-h-[48px] w-full rounded-[12px] border-2 border-[#d1d5db] bg-white ps-11 pe-3 text-[17px]', FOCUS)}
        />
      </label>
      <p className="text-[14px] text-[#5b6475]">
        <span><Fill text={S.selected} values={{ n: selected.length }} lang={lang} /></span>
        <span>{S.sep}<Fill text={S.maxTeachers} values={{ n: MAX_RECIPIENTS }} lang={lang} /></span>
      </p>
      {state === 'loading' ? <p role="status" className="text-[16px] text-[#5b6475]">{S.loadingTeachers}</p> : null}
      {state === 'failed' ? (
        <button type="button" onClick={() => { setState('loading'); setAttempt((a) => a + 1); }} className={cn('min-h-[48px] rounded-[12px] text-[16px] font-semibold text-[#7a271a] underline', FOCUS)}>
          {S.teachersFailed}
        </button>
      ) : null}
      {state === 'empty' ? <p className="text-[16px] text-[#5b6475]">{everAny === false && !q.trim() ? S.noTeachers : S.noTeacherMatch}</p> : null}
      {state === 'ready' ? (
        <ul className="flex flex-col gap-2">
          {teachers.map((t) => {
            const on = selected.includes(t.key);
            const off = !on && full;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={off}
                  onClick={() => toggle(t.key)}
                  className={cn(
                    'flex min-h-[48px] w-full items-center gap-3 rounded-[12px] border-2 px-3 py-2 text-start',
                    on ? 'border-[#2f7a52] bg-[#e9f6ef]' : 'border-[#e5e7eb] bg-white',
                    off && 'cursor-not-allowed opacity-50',
                    FOCUS,
                  )}
                >
                  <span aria-hidden="true" className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-[#2f7a52] bg-[#2f7a52] text-white' : 'border-[#9ca3af]')}>
                    {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span dir="auto" className="truncate text-[17px] font-semibold">{t.name}</span>
                    {t.school ? <span dir="auto" className="truncate text-[14px] text-[#5b6475]">{t.school}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
