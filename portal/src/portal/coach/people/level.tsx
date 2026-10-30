import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ChoiceChips } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { PEOPLE } from "./copy";

/**
 * bd-ewbzns.1 — the teaching level a coach is looking at: Primary, Middle or High, or every teacher (no level).
 *
 * Schools carry no level; teachers do (users.teacher_level, PRIMARY / MIDDLE / HIGH, read by the server). A school is
 * under a level when one of its teachers teaches at it, and a teacher of two levels is under each. A teacher with no
 * level recorded is only under All.
 *
 * Like the School card's period, the level lives in the address (`?level=primary`), so Back, a reload and every link
 * from My schools into a school and on to its pages keep the one she picked. All is the default and is left out.
 */
export type TeachingLevel = "PRIMARY" | "MIDDLE" | "HIGH";
export const LEVELS: readonly TeachingLevel[] = ["PRIMARY", "MIDDLE", "HIGH"];

export const levelOf = (raw: string | null | undefined): TeachingLevel | null => {
  const v = String(raw ?? "").trim().toUpperCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as TeachingLevel) : null;
};

export function useLevel(): [TeachingLevel | null, (next: TeachingLevel | null) => void] {
  const [params, setParams] = useSearchParams();
  const level = levelOf(params.get("level"));
  const set = useCallback((next: TeachingLevel | null) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next) p.set("level", next.toLowerCase()); else p.delete("level");
      return p;
    }, { replace: true });
  }, [setParams]);
  return [level, set];
}

/** A link that carries the level (a path that already has a query, e.g. `?period=month`, keeps it). */
export function withLevel(path: string, level: TeachingLevel | null): string {
  if (!level) return path;
  const [base, query = ""] = path.split("?");
  const p = new URLSearchParams(query);
  p.set("level", level.toLowerCase());
  return `${base}?${p.toString()}`;
}

/** Does this teacher teach at the level (no level: everyone)? */
export const atLevel = (levels: readonly string[] | null | undefined, level: TeachingLevel | null): boolean =>
  !level || (levels ?? []).includes(level);

/** How many teachers teach at each level. */
export function levelCounts(teachers: readonly { levels?: readonly string[] | null }[]): Record<TeachingLevel, number> {
  return Object.fromEntries(LEVELS.map((l) => [l, teachers.filter((t) => (t.levels ?? []).includes(l)).length])) as Record<TeachingLevel, number>;
}

/** "Primary · Middle": her levels in the page's language, or "" when none is recorded. */
export function useLevelNames(): (levels: readonly string[] | null | undefined) => string {
  const C = useCopy(PEOPLE);
  return (levels) => LEVELS.filter((l) => (levels ?? []).includes(l)).map((l) => C.levelNames[l]).join(" · ");
}

/**
 * All · Primary · Middle · High (the kit's ChoiceChips), with only the levels some teacher here teaches. Two levels or
 * more, or one picked already, or nothing is shown: with every teacher at one level there is nothing to choose.
 */
export function LevelChips({ counts }: { counts: Partial<Record<TeachingLevel, number>> | null | undefined }) {
  const C = useCopy(PEOPLE);
  const [level, setLevel] = useLevel();
  const present = LEVELS.filter((l) => (counts?.[l] ?? 0) > 0 || l === level);
  if (present.length < 2 && !level) return null;
  return (
    <div data-testid="level-chips">
      <ChoiceChips label={C.teachingLevel} value={level ?? "ALL"}
        onChange={(k) => setLevel(k === "ALL" ? null : levelOf(k))}
        options={[{ key: "ALL", label: C.allLevels }, ...present.map((l) => ({ key: l, label: C.levelNames[l] }))]} />
    </div>
  );
}
