/**
 * The bottom sheet both Share sheets use: a dimmed page, a white panel from the bottom, a title, a
 * ≥48 px Close; Escape and a tap on the dimmed page close it. Scoped under .fln-root with the chrome's lang/dir.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../teacher/ui/styles';
import { SHARE_DIR, shareStrings, type ShareLang } from './strings.share';
import './share.css';

export function Sheet({ lang, title, onClose, testId, children }: {
  lang: ShareLang;
  title: string;
  onClose: () => void;
  testId?: string;
  children: ReactNode;
}) {
  const S = shareStrings(lang);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fln-root fixed inset-0 z-50 flex flex-col justify-end" lang={lang} dir={SHARE_DIR[lang]}>
      <button type="button" aria-label={S.close} tabIndex={-1} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-[#1f2333]/55" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-testid={testId}
        lang={lang}
        dir={SHARE_DIR[lang]}
        className="fln-sheet-panel relative mx-auto flex max-h-[92vh] w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-t-[24px] bg-white px-4 pt-3 text-[#333748] shadow-[0_-8px_24px_rgba(16,24,40,0.18)] outline-none"
      >
        <span aria-hidden="true" className="mx-auto h-[5px] w-11 shrink-0 rounded-full bg-[#d1d5db]" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="text-[20px] font-bold leading-snug">{title}</h2>
          <button type="button" onClick={onClose} aria-label={S.close} className={cn('flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-full text-[#333748] hover:bg-[#f3f4f6]', FOCUS)}>
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
