import { useEffect, useState, useSyncExternalStore } from 'react';
import { ReadyCard, type ReadyCardRow } from '../ui';
import { useNoticeWords } from './useNoticeWords';
import { useOpenNotice } from './useOpenNotice';
import { noticeTracker } from './tracker';

/**
 * bd-fmf24g.15 — Home's "Ready for you": the finished papers and lesson plans she has not opened, from the server's
 * list (so it is the same after a refresh and on a second phone). Each is kept for 24 weekday hours, Monday to
 * Friday in Pakistan time, or until she opens it — the server decides and stamps `homeUntil`; this only draws
 * what it is given. At most 2 rows and "See all". Open opens the item and tells the server.
 */
export function ReadyForYou({ userKey }: { userKey: string }) {
  const { what, classLine, titleOf } = useNoticeWords();
  const open = useOpenNotice();
  const [listOpen, setListOpen] = useState(false);
  const home = useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getHome, noticeTracker.getHome);

  // Home is where she looks for it: ask the server now, whatever the last answer was.
  useEffect(() => {
    const detach = noticeTracker.attach(userKey);
    void noticeTracker.sync(true);
    return detach;
  }, [userKey]);

  const rows: ReadyCardRow[] = home.map((i) => ({
    id: i.id,
    feature: i.kind === 'lesson' ? 'lessons' : 'assessment',
    what: what(i),
    title: titleOf(i),
    line: classLine(i),
  }));

  return (
    <ReadyCard
      items={rows}
      listOpen={listOpen}
      onOpenList={() => setListOpen(true)}
      onCloseList={() => setListOpen(false)}
      onOpen={(id) => {
        const item = home.find((h) => h.id === id);
        if (!item) return;
        setListOpen(false);
        noticeTracker.settle(id);
        open({ ...item, title: titleOf(item) });
      }}
    />
  );
}
