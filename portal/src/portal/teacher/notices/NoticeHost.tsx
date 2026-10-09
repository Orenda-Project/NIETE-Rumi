import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { failureLabel } from '../assessment/failure';
import { ASSESSMENT } from '../assessment/copy';
import { OBSERVE } from '../../coach/observe/copy';
import { failureWords, observationLine } from '../../coach/observe/format';
import { useCopy, useLang } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { teacherPath } from '../routes';
import { ReadyBanner, ReadyTray, trayHeight, type BannerRow, type TrayRow } from '../ui';
import { ROW_PX, ROW_PX_UR } from '../ui/ReadyTray';
import { useKitCopy } from '../ui/useKitCopy';
import { NOTICES } from './copy';
import { useNoticeWords } from './useNoticeWords';
import { useOpenNotice } from './useOpenNotice';
import { isOnOwnPage, minutesLeft, progressOf, type NoticeItem } from './model';
import { noticeTracker } from './tracker';

/**
 * bd-fmf24g.15 — the notices, on every teacher screen: what is being made (a strip just above the bottom menu),
 * and the ready / failed banner above it. Mounted by the shell (PortalLayout) for a teacher on v2 only, so a page
 * never has to remember it. It draws what the tracker follows (tracker.ts) and decides what each tap means:
 *
 *   strip   up to 2 rows, "+N more" opens the list. A failed item's row stays until she taps it (the tap is the
 *           acknowledgement); the item her own page already shows is not repeated.
 *   banner  a ready item is announced once, for 10 seconds, above the menu. Open opens it (a plan in the viewer, a
 *           paper on its page); ✕ and running out both mean SEEN — the item is done, nothing more is sent from here.
 *           A failure is announced the same way, in red, with Try again; its row then waits in the strip.
 *   own page  she is looking at the item itself (the waiting page, or the plan opening by itself): nothing is
 *           repeated, and the item is settled — there is nothing left to tell her.
 *   bare    a screen with no menu (recording): nothing is drawn, nothing is lost; the next screen shows it.
 *
 * A failure goes to the app only: nothing here, or anywhere, sends a failure to WhatsApp.
 *
 * bd-4404s7.4 — the coach's observation being SENT is one more kind of item (an upload, not a render): the same strip
 * ("Observation · Ayesha Bibi — Sending · 62%"), the same banner ("Observation sent", Open; or "Couldn't send", the
 * real reason, Try again). It is mounted for a coach on v2 as it is for a teacher.
 *
 * The strip's height goes to the page (`--notice-h` on <html>, and a spacer in flow) so a page's last row and its
 * bottom action stay above the strip.
 */

function useTrackedItems(): readonly NoticeItem[] {
  return useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getItems, noticeTracker.getItems);
}

/** A clock for "~1 min left", only while something is being made. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function NoticeHost({ userKey, bare = false, aboveBar = false, local = false }: { userKey: string; bare?: boolean; aboveBar?: boolean; local?: boolean }) {
  const kit = useKitCopy();
  const lang = useLang();
  const C = useCopy(NOTICES);
  const { what, classLine, titleOf } = useNoticeWords();
  const assessC = useCopy(ASSESSMENT);
  const observeC = useCopy(OBSERVE);
  const lessonsC = useCopy(LESSONS);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const open = useOpenNotice();
  const items = useTrackedItems();
  const [listOpen, setListOpen] = useState(false);

  // `local` (a coach): what is followed is sent from this phone; the teacher's server list is not hers to ask.
  useEffect(() => noticeTracker.attach(userKey, { server: !local }), [userKey, local]);

  const own = useCallback((i: NoticeItem) => isOnOwnPage(i, pathname, search), [pathname, search]);

  // She is looking at the item itself: the page shows it, so there is nothing left to tell her.
  useEffect(() => {
    items.filter((i) => i.state !== 'making' && own(i)).forEach((i) => noticeTracker.settle(i.id));
  }, [items, own]);

  // A tap on a row, or any move to another screen, shuts the list.
  useEffect(() => { setListOpen(false); }, [pathname, search]);

  const stripItems = useMemo(
    () => items.filter((i) => (i.state === 'making' || (i.state === 'failed' && i.announced)) && !own(i)),
    [items, own],
  );
  const readyItems = items.filter((i) => i.state === 'ready' && !i.announced && !own(i));
  const failedItem = items.find((i) => i.state === 'failed' && !i.announced && !own(i)) ?? null;

  const now = useNow(stripItems.some((i) => i.state === 'making'));

  const featureOf = (i: NoticeItem) => (i.kind === 'lesson' ? 'lessons' : i.kind === 'observation' ? 'observations' : 'assessment');

  const rows: TrayRow[] = stripItems.map((i) => {
    const left = minutesLeft(i, now);
    if (i.kind === 'observation') {
      return {
        id: i.id,
        feature: 'observations',
        what: what(i),
        gradeSubject: i.title,
        title: observationLine(i.visitDay, i.durationMs, observeC),
        state: i.state === 'failed' ? 'failed' : 'making',
        progress: progressOf(i, now),
        left: '',
        to: i.waitHref,
        status: i.state === 'failed'
          ? `${kit.notify.couldntSend} · ${kit.notify.tryAgain}`
          : kit.notify.sending(Math.round(progressOf(i, now) * 100)),
      };
    }
    return {
      id: i.id,
      feature: featureOf(i),
      what: what(i),
      gradeSubject: classLine(i),
      title: titleOf(i),
      state: i.state === 'failed' ? 'failed' : 'making',
      progress: progressOf(i, now),
      left: left === null ? '' : kit.notify.timeLeft(left),
      to: i.waitHref,
    };
  });

  const banner = (i: NoticeItem): BannerRow => ({
    id: i.id,
    feature: featureOf(i),
    what: what(i),
    title: titleOf(i),
    line: i.kind === 'observation'
      ? observationLine(i.visitDay, i.durationMs, observeC)
      : i.kind === 'paper' && i.questions != null ? `${classLine(i)} · ${kit.notify.questions(i.questions)}` : classLine(i),
  });

  const showStrip = !bare && rows.length > 0;
  const height = showStrip ? trayHeight(Math.min(rows.length, 2), rows.length > 2, lang === 'ur' ? ROW_PX_UR : ROW_PX) : 0;
  useEffect(() => {
    const root = document.documentElement;
    if (height > 0) root.style.setProperty('--notice-h', `${height}px`);
    else root.style.removeProperty('--notice-h');
    return () => { root.style.removeProperty('--notice-h'); };
  }, [height]);

  const openItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    noticeTracker.settle(id);
    open({ ...item, title: titleOf(item) });
  };

  const finish = (ids: readonly string[], how: 'closed' | 'expired') => noticeTracker.announced(ids, how);

  const retry = async (id: string) => {
    const res = await noticeTracker.retry(id);
    if ('error' in res) {
      const observation = id.startsWith('observation:');
      toast({ title: observation ? kit.notify.couldntSend : kit.notify.couldntMake, description: res.error || undefined, variant: 'destructive' });
    }
  };

  if (bare) return null;

  const reason = failedItem
    ? (failedItem.kind === 'observation' ? failureWords(failedItem.errorCode, observeC)
      : failedItem.kind === 'paper' ? failureLabel(failedItem.errorCode, assessC) : lessonsC.notPrepared)
    : undefined;

  return (
    <>
      {height > 0 && <div data-testid="notice-spacer" aria-hidden="true" style={{ height }} />}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 z-[45] flex flex-col md:bottom-0',
          // The v2 menu is 78px + the safe area; the recording bar, when it shows, is 80px more (PortalLayout's own sums).
          aboveBar ? 'bottom-[calc(78px+80px+env(safe-area-inset-bottom))]' : 'bottom-[calc(78px+env(safe-area-inset-bottom))]',
        )}
      >
        <div className="pointer-events-auto mx-auto flex w-full max-w-xl flex-col">
          {readyItems.length > 0 ? (
            <div className="px-2 pb-2">
              <ReadyBanner
                items={readyItems.map(banner)}
                onOpen={openItem}
                onClose={() => finish(readyItems.map((i) => i.id), 'closed')}
                onExpire={() => finish(readyItems.map((i) => i.id), 'expired')}
                // Three or more at once: Home's card holds them all (going there is acting on the banner).
                onSeeAll={() => { finish(readyItems.map((i) => i.id), 'closed'); navigate(teacherPath('home')); }}
              />
            </div>
          ) : failedItem ? (
            <div className="px-2 pb-2">
              <ReadyBanner
                variant="failed"
                items={[banner(failedItem)]}
                reason={reason}
                onOpen={openItem}
                onRetry={(id) => { void retry(id); }}
                onClose={() => finish([failedItem.id], 'closed')}
                onExpire={() => finish([failedItem.id], 'expired')}
              />
            </div>
          ) : null}
          <ReadyTray
            items={rows}
            onFollow={(id) => { if (items.find((i) => i.id === id)?.state === 'failed') noticeTracker.settle(id); }}
            onOpenList={() => setListOpen(true)}
            listOpen={listOpen}
            onCloseList={() => setListOpen(false)}
            note={C.listNote}
          />
        </div>
      </div>
    </>
  );
}
