import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, FileSpreadsheet, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNativeApp } from '@/lib/runtime';
import TeacherPage from '../TeacherPage';
import { StatusChip } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { getClasses, getMonth, saveRegister, sendRegister, useRead } from './api';
import { ATTENDANCE_V2_COPY as C } from './copy';
import { monthLabel, monthOf, shiftMonth } from './model';
import { ATTENDANCE_V2_BASE, downloadPath } from './paths';
import { ClassCard, ClassTray, LoadState } from './ui';

/**
 * bd-fmf24g.7 — a class's month register (v28 canvas AttendanceDownload.dc.html): the class card (tap =
 * Change), the month (this, last, or one of the twelve before), and the register — the same Excel file
 * WhatsApp sends after each register (GET …/register). WhatsApp sends it to her chat through the bot's
 * existing delivery. In the app the browser cannot save a file, so the app offers WhatsApp only.
 */

type Pick = 'this' | 'last' | 'other';

export function DownloadPage() {
  const { listId = '' } = useParams();
  const classes = useRead('classes', () => getClasses());
  const today = classes.data?.date || null;
  const thisMonth = today ? monthOf(today) : null;
  const [pick, setPick] = useState<Pick>('this');
  const [other, setOther] = useState<string | null>(null);
  const [tray, setTray] = useState(false);
  const [sent, setSent] = useState<boolean | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const native = isNativeApp();

  const earlier = useMemo(() => (thisMonth ? Array.from({ length: 10 }, (_, i) => shiftMonth(thisMonth, -(i + 2))) : []), [thisMonth]);
  const month = !thisMonth ? null : pick === 'this' ? thisMonth : pick === 'last' ? shiftMonth(thisMonth, -1) : (other || earlier[0]);
  const monthRead = useRead(month ? `month:${listId}:${month}` : null, () => getMonth(listId, month as string));

  useEffect(() => { setTray(false); setSent(null); setSaveFailed(false); }, [listId, month]);

  const cls = classes.data?.classes.find((c) => c.listId === listId) || null;

  const send = async () => {
    if (!month || busy) return;
    setBusy(true);
    setSent(await sendRegister(listId, month));
    setBusy(false);
  };
  const save = async () => {
    if (!month || busy) return;
    setBusy(true);
    setSaveFailed(!(await saveRegister(listId, month)));
    setBusy(false);
  };

  const chip = (key: Pick, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={pick === key}
      onClick={() => setPick(key)}
      className={cn('min-h-[56px] rounded-full border-[1.5px] px-4 text-[15px] font-semibold', FOCUS,
        pick === key ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#d1d5db] bg-white text-[#1d2025]')}
    >
      {label}
    </button>
  );

  return (
    <TeacherPage
      title={C.downloadTitle}
      crumb={C.title}
      backTo={ATTENDANCE_V2_BASE}
      feature="attendance"
      testId="attendance-download"
      dock={month ? (
        <div className="flex w-full flex-col gap-2">
          {sent === true && <StatusChip text={C.sent} tone="done" />}
          {sent === false && <StatusChip text={C.notSent} tone="error" />}
          {saveFailed && <StatusChip text={C.downloadFailed} tone="error" />}
          <div className="flex gap-2.5">
            <button type="button" onClick={send} disabled={busy} className={cn('flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[16px] font-semibold disabled:opacity-60', FOCUS)}>
              <Send className="h-5 w-5" aria-hidden="true" />{C.whatsapp}
            </button>
            {!native && (
              <button type="button" onClick={save} disabled={busy} className={cn('flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:opacity-60', FOCUS)}>
                <Download className="h-5 w-5" aria-hidden="true" />{C.download}
              </button>
            )}
          </div>
        </div>
      ) : undefined}
    >
      <LoadState loading={classes.loading && !classes.data} failed={classes.error} onRetry={classes.reload} />
      {cls && <ClassCard cls={cls} chip={false} onPress={() => setTray(true)} />}
      {thisMonth && (
        <>
          <h2 className="mx-1 mt-2 text-[20px] font-light">{C.month}</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={C.month}>
            {chip('this', C.thisMonth)}
            {chip('last', C.lastMonth)}
            {chip('other', C.otherMonth)}
          </div>
          {pick === 'other' && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={C.otherMonth}>
              {earlier.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={(other || earlier[0]) === m}
                  onClick={() => setOther(m)}
                  className={cn('min-h-[56px] rounded-full border-[1.5px] px-4 text-[15px] font-semibold', FOCUS,
                    (other || earlier[0]) === m ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#d1d5db] bg-white text-[#1d2025]')}
                >
                  {monthLabel(m)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {month && cls && (
        <>
          <h2 className="mx-1 mt-2 text-[20px] font-light">{C.register}</h2>
          <section className={cn(CARD, 'flex items-center gap-3 p-3.5')} aria-label={C.register}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#eaf6ef] text-[#1e5c3f]">
              <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[16px] font-semibold">{monthLabel(month)}</span>
              <span className="text-[13px] text-[#6b7280]">{monthRead.data ? C.daysMarked(monthRead.data.days.length) : C.noValue}</span>
            </span>
            <StatusChip text={C.excel} tone="info" />
          </section>
        </>
      )}
      {classes.data && (
        <ClassTray open={tray} onClose={() => setTray(false)} classes={classes.data.classes} currentId={listId} to={downloadPath} />
      )}
    </TeacherPage>
  );
}
