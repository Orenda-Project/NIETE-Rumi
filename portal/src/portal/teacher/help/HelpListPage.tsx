import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import TeacherPage from '../TeacherPage';
import { TEACHER_FRAME } from '../copy';
import { useCopy } from '../i18n';
import { teacherPath } from '../routes';
import { FeatureArt, type AnyFeature } from '../icons';
import { ListRow } from '../ui/ListRow';
import { LIST_CARD } from '../ui/styles';
import { HELP } from './copy';
import { HelpTray } from './HelpButton';
import { useVideoName } from './names';
import { markHelpSeen, type HelpVideo } from './api';
import { useHelp } from './useHelp';
import nieteLogo from '@/assets/niete-logo.png';

/**
 * bd-ik5e8j.4 — More → How to use: every help video for her role, in the manifest's order (Film 1 first, then Home's
 * order). Empty until the films are uploaded: "Videos coming soon". Switch off: back to More (no dead page).
 */
/**
 * bd-ik5e8j.6 — each film's icon, the app's own (the operator, 12 Nov: "we need icons for these"): Film 1 (how to use
 * NIETE) the NIETE mark from Home's band, every other film its feature's Home tile art. Decorative: the row's words
 * name the film.
 */
function FilmIcon({ feature }: { feature: string }) {
  if (feature === 'start') {
    return <img src={nieteLogo} alt="" aria-hidden="true" data-help-art="start" className="h-[34px] w-[34px] object-contain" />;
  }
  return <FeatureArt feature={feature as AnyFeature} size={40} />;
}

export default function HelpListPage() {
  const C = useCopy(TEACHER_FRAME);
  const H = useCopy(HELP);
  const name = useVideoName();
  const help = useHelp();
  const [open, setOpen] = useState<HelpVideo | null>(null);
  if (help.on === false) return <Navigate to={teacherPath('more')} replace />;
  const videos = help.data?.videos ?? [];
  return (
    <TeacherPage crumb={C.more.title} title={H.howTo} backTo={teacherPath('more')} testId="help-list">
      {help.data && !videos.length ? (
        <p data-testid="help-list-empty" className="mx-1 text-[17px] font-semibold text-[#4b5563]">{H.allComingSoon}</p>
      ) : null}
      {videos.length ? (
        <section className={LIST_CARD}>
          {videos.map((v, i) => (
            <ListRow
              key={`${v.feature}-${i}`}
              variant="row"
              first={i === 0}
              glyph={<FilmIcon feature={v.feature} />}
              label={name(v.feature)}
              chip={v.seconds ? { text: H.length(v.seconds), tone: 'info' } : undefined}
              onPress={() => { setOpen(v); markHelpSeen(); }}
            />
          ))}
        </section>
      ) : null}
      <HelpTray open={!!open} onClose={() => setOpen(null)} feature={open?.feature ?? 'start'} video={open} showList={false} />
    </TeacherPage>
  );
}
