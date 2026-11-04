import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { Loading, SearchBox, TapRow, RowText, Initials, useLoad } from "../ui";
import { PEOPLE } from "../people/copy";
import { SCHOOL_CARD } from "../card/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { LevelChips, atLevel, levelCounts, useLevel, useLevelNames, withLevel } from "../people/level";

/**
 * bd-ewbzns.2 — Edit teacher, from the school's Manage group: the WhatsApp /observe "Manage teachers → Edit a teacher".
 * The school's teachers A to Z, each with her role and teaching levels ("Principal · Middle · High"), each opening her
 * Edit teacher (name, number, role, teaching level, school). Save there comes back here, so the row shows what changed.
 * Teaching level chips as on the school's page; a name search above 10 teachers, as there.
 */
const SEARCH_FROM = 10;

const CoachPickTeacher = () => {
  const C = useCopy(PEOPLE);
  const S = useCopy(SCHOOL_CARD);
  const levelNames = useLevelNames();
  const { emis = "" } = useParams();
  const [level] = useLevel();
  const [query, setQuery] = useState("");
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const here = withLevel(`/portal/coach/school/${encodeURIComponent(emis)}/edit-teacher`, level);

  const everyone = useMemo(() => (data?.teachers || []).filter((t) => t.teacherExtId), [data]);
  const q = query.trim().toLowerCase();
  const shown = everyone
    .filter((t) => atLevel(t.levels, level) && (!q || t.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sub = (t: (typeof everyone)[number]) => [t.isPrincipal ? C.rolePrincipal : C.roleTeacher, levelNames(t.levels)].filter(Boolean).join(" · ");

  return (
    <PeopleFrame title={C.editTeacher} crumb={data?.school?.name || C.dash} feature="schools"
      backTo={withLevel(`/portal/coach/school/${encodeURIComponent(emis)}`, level)}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <LevelChips counts={levelCounts(everyone)} />
          {everyone.length > SEARCH_FROM && <SearchBox value={query} onChange={setQuery} placeholder={S.teacherName} />}
          {shown.length === 0 && <EmptyRow testId="no-teachers" icon={<span>·</span>}>{q ? S.noMatch : C.noneAtLevel}</EmptyRow>}
          <div className="flex flex-col gap-2.5">
            {shown.map((t) => (
              <TapRow key={t.teacherExtId} testId="pick-teacher" to={`/portal/coach/teacher/${encodeURIComponent(t.teacherExtId as string)}/edit`}
                state={{ back: here }}>
                <Initials name={t.name} round />
                <RowText wrap name={<span dir="auto">{t.name}</span>} sub={sub(t)} />
              </TapRow>
            ))}
          </div>
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachPickTeacher;
