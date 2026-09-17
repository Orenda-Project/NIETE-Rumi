"""The 2026-27 school year as periods, not days.

The previous matrix laid one period per subject per school day: 5 a week,
141 slots between 6 April and 24 December. Three core books do not fit in 141
(G1 Maths -2, G1 Urdu -1) and two clear it by a single day, which is why the
later chapters had to be compressed. Core subjects are timetabled 5-6 periods
a week, so everything here is counted in periods.

Dates are from the FDE Basic Calendar of Activities 2026-27
(F.1-350/2020(Academics), 6 April 2026), corrected against the break dates
FDE writes into its own seventeen syllabus-breakdown documents. Where the two
disagree the breakdown wins, because that is the calendar the syllabus is
actually paced against. Each correction is named at the line it changes.
"""
from datetime import date, timedelta

SESSION_START = date(2026, 4, 6)          # 1-4 April is session preparation
CONTENT_END = date(2026, 12, 24)          # curriculum must finish here
SESSION_END = date(2027, 3, 31)

BREAKS = [
    # Closed 25 May, not 1 June: the federal government merged Eid-ul-Azha
    # into the summer break and shut Islamabad public-sector schools from
    # 25 May. Confirmed by Amena, 17 Sep 2026. The breakdown docs had it
    # right and the Calendar of Activities did not.
    (date(2026, 5, 25), date(2026, 7, 31), "Summer vacations"),
    (date(2026, 12, 25), date(2027, 1, 1), "Winter vacations"),
]

# Gazetted national closures inside the session.
HOLIDAYS = {date(2026, 5, 1): "Labour Day",
            date(2026, 8, 14): "Independence Day",
            date(2026, 8, 25): "Eid Milad-un-Nabi (lunar — date estimated)",
            date(2026, 11, 9): "Iqbal Day",
            date(2027, 2, 5): "Kashmir Day",
            date(2027, 3, 23): "Pakistan Day"}

# The Calendar of Activities above is what this file follows. FDE's seventeen
# syllabus-breakdown documents write different dates, and a school pacing off
# those will be out of step with this calendar by a few days. Named here so
# the gap is visible rather than discovered in May.
DEVIATIONS = [
    ("Summer vacations",
     "11 of the 17 breakdown docs start summer 25-27 May; the Calendar of "
     "Activities says 1 June. The breakdown docs were right. The federal "
     "government merged Eid-ul-Azha into the break and closed Islamabad "
     "public-sector schools from 25 May, so this calendar now starts summer "
     "there and the year is five school days shorter than the Calendar of "
     "Activities implies. The 1st Assessment moved back a week with it."),
    ("1-19 March 2027",
     "6 breakdown docs schedule Eid-ul-Fitr vacations here, while the "
     "Calendar of Activities schedules the Final / 5th Assessment across the "
     "whole of March. This calendar follows the Calendar of Activities and "
     "keeps March as assessment. ⚠ If the vacation is gazetted, Grade 5 "
     "board prep loses about 13 school days and has to move into January."),
]

# Official assessment windows, by the grades they bind (FDE calendar).
ASSESSMENTS = [
    # The Calendar of Activities put this at 25-29 May, which the closure
    # above swallowed whole. Moved to the last full week schools were open.
    (date(2026, 5, 18), date(2026, 5, 22), "1st Assessment", "G1-5"),
    (date(2026, 9, 7), date(2026, 9, 11), "2nd Assessment", "G1-2"),
    (date(2026, 10, 12), date(2026, 10, 16), "2nd Assessment / Mid-Term",
     "G3 · G4-5"),
    (date(2026, 11, 9), date(2026, 11, 13), "3rd Assessment", "G1-2"),
    (date(2026, 12, 7), date(2026, 12, 11), "3rd Assessment / 2nd Bimonthly",
     "G3 · G4-5"),
    (date(2027, 1, 11), date(2027, 1, 15), "4th Assessment", "G1-2"),
    (date(2027, 3, 1), date(2027, 3, 31), "Final / 5th Assessment", "G1-5"),
]

# Periods a week, planned conservatively: one period a day for English and
# Urdu, Maths taking the extra sixth because multiplication and the CPA ramp
# need the time, Science at three against General Knowledge. PERIODS_ALT is
# the top of the band a school can run if it has the slots - it is a ceiling
# to plan against, not the plan.
PERIODS_PER_WEEK = {"English": 5, "Urdu": 5, "Maths": 6, "Science": 3}
PERIODS_ALT = {"English": 6, "Urdu": 6, "Maths": 6, "Science": 4}

# Two grade-subjects need the top of their band rather than the bottom, and
# the reason is the book, not a preference. Grade 1 Urdu is 142 periods of
# قاعدہ and reading against 135 at five a week, Grade 5 Urdu is 140. At five
# the calendar simply stops before the book does and the last chapters are
# never taught; at six both fit with room. Every other grade-subject stays on
# the conservative rate. Read this through periods_for(), never the table.
PERIODS_BY_GRADE = {("Urdu", 1): 6, ("Urdu", 5): 6}


def periods_for(subject, grade):
    """Periods a week for one grade-subject — the only authority on the rate."""
    return PERIODS_BY_GRADE.get((subject, grade), PERIODS_PER_WEEK[subject])


def in_break(day):
    for start, end, name in BREAKS:
        if start <= day <= end:
            return name
    return None


def school_days(start=SESSION_START, end=SESSION_END):
    out, day = [], start
    while day <= end:
        if day.weekday() < 5 and not in_break(day) and day not in HOLIDAYS:
            out.append(day)
        day += timedelta(days=1)
    return out


def weeks(days):
    """Group school days into Monday-anchored weeks, in order."""
    buckets = {}
    for day in days:
        buckets.setdefault(day - timedelta(days=day.weekday()), []).append(day)
    return [(monday, buckets[monday]) for monday in sorted(buckets)]


def periods_in(week_days, per_week):
    """Periods available in a short week — pro-rata on the days actually open.

    A week cut to three days by Independence Day carries three fifths of the
    periods, rounded up: the timetable loses the day, not the double period.
    """
    return -(-len(week_days) * per_week // 5)


def assessment_for(monday, week_days):
    hits = []
    for start, end, name, grades in ASSESSMENTS:
        if any(start <= d <= end for d in week_days):
            hits.append((name, grades))
    return hits


def term_of(monday):
    if monday < date(2026, 5, 25):
        return "Term 1 · pre-summer"
    if monday < date(2026, 12, 25):
        return "Term 1 · post-summer"
    return "Term 2 · revision & board prep"


def budget(per_week, end=CONTENT_END):
    """Periods available from session start to `end`, at `per_week` a week."""
    return sum(periods_in(w, per_week)
               for m, w in weeks(school_days(end=end)))


def summary():
    content = school_days(end=CONTENT_END)
    revision = [d for d in school_days() if d > CONTENT_END]
    return {"content_days": len(content),
            "revision_days": len(revision),
            "content_weeks": len(weeks(content)),
            "revision_weeks": len(weeks(revision)),
            "budget": {n: {s: budget(p) for s, p in tbl.items()}
                       for n, tbl in (("planned", PERIODS_PER_WEEK),
                                      ("upper", PERIODS_ALT))}}


if __name__ == "__main__":
    import json
    print(json.dumps(summary(), indent=2))
