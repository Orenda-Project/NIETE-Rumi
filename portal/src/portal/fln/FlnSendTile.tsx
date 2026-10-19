/**
 * The builder's entry for v2 coaches, a tile in the Training Library's tiles grid (LibraryHome),
 * drawn like the provider tiles beside it and spanning both columns so it never breaks their odd-one-out rule.
 * NOTHING unless GET /api/portal/fln/me says share:true. `lang` = the page's language (LibraryHome passes its own).
 */
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CARD, FOCUS } from '../teacher/ui/styles';
import { SHARE_DIR, shareStrings, type ShareLang } from './share/strings.share';
import { langOf, useFlnMe } from './share/useFlnMe';
import './share/share.css';

export default function FlnSendTile({ lang: pageLang }: { lang?: ShareLang }) {
  const me = useFlnMe();
  if (!me || me.share !== true) return null;
  const lang = pageLang ?? langOf(me);
  const S = shareStrings(lang);
  return (
    <Link
      to="/portal/fln/send"
      data-testid="fln-send-tile"
      lang={lang}
      dir={SHARE_DIR[lang]}
      className={cn(CARD, 'fln-root col-span-2 flex min-h-[150px] flex-col items-start justify-between gap-3 rounded-[18px] p-4', FOCUS)}
    >
      <span aria-hidden="true" className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[14px] bg-[#47BA7D] text-white">
        <Send className="h-7 w-7" strokeWidth={2.2} />
      </span>
      <span className="flex flex-col items-start gap-1">
        <b className="text-[18px] font-semibold leading-tight">{S.cardTitle}</b>
        <span className="text-[13px] text-[#6b7280]">{S.cardBody}</span>
      </span>
    </Link>
  );
}
