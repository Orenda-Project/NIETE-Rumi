import { useEffect, useState } from 'react';
import { FOCUS } from '../../ui/styles';
import type { OwnCopy } from './copy';
import { fetchBookPages, type BookText } from './api';
import type { PageRange } from './pages';

/**
 * "From your book": the text of the pages she chose, as book pages in a sideways strip (220px cards,
 * scroll-snap, serif on cream paper, Urdu right to left), 400ms after the numbers settle. States: loading, the pages, a
 * page missing from our copy (she can go on), the book not loaded yet. It never blocks OK. Page pictures do not exist
 * yet: the footer says "design pending" and no stand-in picture is drawn (dark stages stay dark).
 */
const LINES = 12;
/** Past this many characters a page needs "Show all" even with few line breaks (12 lines of a 220px card). */
const CHARS = 360;

export function BookPages({ C, lesson, lane, range, delay = 400 }: {
  C: OwnCopy; lesson: string; lane: 'k5' | 'g612'; range: PageRange | null; delay?: number;
}) {
  const [book, setBook] = useState<BookText | null | 'loading'>('loading');
  const from = range?.start ?? 0;
  const to = range?.end ?? 0;
  useEffect(() => {
    if (!from) return undefined;
    let live = true;
    setBook('loading');
    const t = setTimeout(() => {
      void fetchBookPages({ lesson, lane, from, to }).then((b) => { if (live) setBook(b); });
    }, delay);
    return () => { live = false; clearTimeout(t); };
  }, [lesson, lane, from, to, delay]);

  if (!from || book === null) return null; // could not reach it: the book is a help, never a wall
  return (
    <section className="flex flex-col gap-2" data-testid="own-book">
      <h2 className="text-[13px] font-semibold text-[#4b5563]">{C.fromYourBook}</h2>
      {book === 'loading' ? (
        <div className="h-[160px] w-[220px] motion-safe:animate-pulse rounded-xl bg-[#f3efe4]" data-testid="own-book-loading" />
      ) : !book.loaded ? (
        <p className="text-[14px] text-[#6b7280]" data-testid="own-book-none">{C.bookNotLoaded}</p>
      ) : (
        <>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
            {book.pages.map((p) => <Page key={p.page} C={C} page={p.page} text={p.text} />)}
          </div>
          {book.missing.map((n) => (
            <p key={n} className="text-[14px] text-[#92400e]" data-testid={`own-book-missing-${n}`}>{C.pageMissing(n)}</p>
          ))}
        </>
      )}
      <p className="text-[12px] text-[#6b7280]">{C.picturesPending}</p>
    </section>
  );
}

function Page({ C, page, text }: { C: OwnCopy; page: number; text: string }) {
  const [all, setAll] = useState(false);
  // Clamped on screen (CSS line-clamp), so one long paragraph is held to 12 lines as well as many short ones.
  const long = text.split('\n').length > LINES || text.length > CHARS;
  return (
    <article className="flex w-[220px] shrink-0 snap-start flex-col gap-1 rounded-xl border border-[#e7e0cc] bg-[#fbf8ef] p-3" data-testid={`own-book-page-${page}`}>
      <h3 className="text-[12px] font-semibold text-[#6b7280]">{C.pageN(page)}</h3>
      <p dir="auto" data-testid={`own-book-text-${page}`} className={`whitespace-pre-line font-serif text-[14px] leading-snug text-[#1f2937] ${all ? '' : 'line-clamp-[12]'}`}>
        {text}
      </p>
      {long ? (
        <button type="button" onClick={() => setAll(!all)} className={`self-start min-h-[48px] text-[13px] font-semibold text-[#4f46e5] ${FOCUS}`}>
          {all ? C.showLess : C.showAll}
        </button>
      ) : null}
    </article>
  );
}
