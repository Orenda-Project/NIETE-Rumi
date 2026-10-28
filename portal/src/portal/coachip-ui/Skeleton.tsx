/**
 * bd-sex15q.42 — the first paint (DESIGN_SYSTEM §7, ux-lead idea 130659): the final layout with no words, fixed
 * heights from the tokens, so the page does not jump when the data lands (CLS < 0.1). `band` adds the navy band with an
 * empty ring track (the login landing); without it, a ring row and three rows under a page's own band or app bar.
 */
export function Skeleton({ band = false, testId = "cp-skeleton" }: { band?: boolean; testId?: string }) {
  const bar = "cp-skeleton block rounded-full";
  return (
    <div data-testid={testId} aria-busy="true" className="flex flex-col">
      {band && (
        <div className="cp-band">
          <div className="cp-lattice" />
          <span className={`${bar} h-6 w-40 bg-white/15`} />
          <div className="mt-5 flex items-center gap-4">
            <span className="block h-[104px] w-[104px] shrink-0 rounded-full border-[10px] border-white/15" />
            <span className="flex flex-1 flex-col gap-2.5">
              <span className={`${bar} h-5 w-20 bg-white/15`} />
              <span className={`${bar} h-4 w-full bg-white/10`} />
              <span className={`${bar} h-4 w-4/5 bg-white/10`} />
            </span>
          </div>
        </div>
      )}
      <div className={`${band ? "cp-overlap mx-5 lg:mx-0" : ""} flex items-center gap-4 rounded-[20px] bg-cp-surface p-5 shadow-[0_2px_8px_rgba(51,55,72,0.08)]`}>
        <span className="block h-16 w-16 shrink-0 rounded-full border-[7px] border-cp-hairline" />
        <span className="flex flex-1 flex-col gap-2.5">
          <span className={`${bar} h-4 w-24 bg-cp-hairline`} />
          <span className={`${bar} h-3.5 w-full bg-cp-hairline`} />
        </span>
      </div>
      <div className={`${band ? "mx-5 lg:mx-0" : ""} mt-5 flex flex-col`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 border-t border-cp-hairline py-4 first:border-t-0">
            <span className={`${bar} h-4 w-4/5 bg-cp-hairline`} />
            <span className={`${bar} h-3 w-2/5 bg-cp-hairline`} />
          </div>
        ))}
      </div>
    </div>
  );
}
