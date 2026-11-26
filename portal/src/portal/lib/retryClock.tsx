import { useEffect, useState } from "react";

/**
 * bd-q261rec (queue #261) — "Trying again 0:19": the time to a waiting send's next try, ticking each second. 0:00 at the
 * end; the sender goes on by itself (lib/pieceUpload), and Try now (wakePieces) ends the wait at once.
 */
export function clockUntil(until: number, now: number): string {
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function RetryIn({ until, words, testId, className }: {
  until: number; words: (clock: string) => string; testId: string; className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return <span data-testid={testId} className={className}>{words(clockUntil(until, now))}</span>;
}
