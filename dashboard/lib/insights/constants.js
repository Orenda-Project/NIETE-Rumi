'use strict';
/**
 * COACHIP nightly insight job (bd-sex15q.14): the named constants every stage reads.
 * Contracts: NIGHTLY_JOB.md v1 (c-insights), FICO_CROSSWALK.md v1.1, INSIGHTS_SCHEMA.md v1.1.
 * MAJOR or MINOR of PIPELINE_VERSION changes a count (a new series, B19); PATCH changes no number.
 */

const PIPELINE_VERSION = 'coachip-1.0.0';

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const PROD_REF = 'ihzciabopbttygxxgrkm';
// The prod write path stays shut in code until the operator's go (B11; ORG §6 item 1). A test asserts it.
const PROD_WRITES_ALLOWED = false;
// COACHIP_ENV → the project ref the job may write to. Staging and production come from the go package.
const EXPECTED_REFS = Object.freeze({ sandbox: SANDBOX_REF, staging: null, production: PROD_REF });
const CLIP_BUCKETS = Object.freeze({ sandbox: 'rumi-sandbox', staging: null, production: null });

const SECTORS = Object.freeze(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
const TZ = 'Asia/Karachi';

// The cause split (WEAKNESS_MAP §A; tuned on the first week, O6).
const MARGIN_TAIL_S = 60;
const MARGIN_NOPLAN_EXIT_S = 120;
const PRACTICE_SECONDS_PER_PRESCRIBED_MINUTE = 60;

// FICO_CROSSWALK rule 2 (O5 settled 10:08Z: required move = counted = true), with the governed query's verdict lists
// (x-data Q2b_last28d.sql:40-52) so B14 holds to the digit.
const DONE_VERDICTS = Object.freeze(['executed', 'substituted_equivalent', 'substituted_better']);
const DONE_OR_PARTIAL_VERDICTS = Object.freeze([...DONE_VERDICTS, 'partial']);
const NOT_DONE = 'not_done';

// Series starts (FICO_CROSSWALK §1). A window that would start before its W's series start is not computed (B19).
const SERIES_START = Object.freeze({
  'lp_fidelity:google/gemini-3.8-flash': '2026-09-28',
  lp_fidelity: '2026-09-28',
  fico_v3: '2026-09-14',
  fico17: '2026-10-12', // first Monday on or after the first /observe2 visit (9 Oct 2026)
  code: '2026-09-28',
  coachip_detector: null, // the first night the job runs; set from coachip_job_runs
  egra: '2026-10-26',
});
const HISTORY_ONLY_GRADERS = Object.freeze(['openai/gpt-5.6-luna']);

// Floors (NIGHTLY_JOB §5; DB CHECKs on coachip_rollups) and B23.
const FLOORS = Object.freeze({ coach: 20, school: 20, sector: 40 });
const SECTOR_MIN_COACHES_5PLUS = 3;
const SECTOR_COACH_MIN_LESSONS = 5;
const WINDOW_WEEKS = Object.freeze([4, 8]);

// Ranking (NIGHTLY_JOB §4 stage 7; WEAKNESS_MAP §0.4).
const PRIORITY_MIN_SHARE = 0.40;
const PRIORITY_MIN_TEACHERS = 3;
const PRIORITY_SECTOR_MULTIPLE = 1.5;
const HYSTERESIS_BAND = 0.10;
// Held out of the S1 ranking until c-insights / the lead rule (board 13:17Z): on prod v3, C1 sits at 2 on 90% of
// lessons and C3 on 57%, so `score <= 2` would put W-Q first for 54 of 56 coaches. Rows are still computed (S6).
const RANKING_HELD_OUT = Object.freeze(['W-Q', 'W-FB']);

// Check strips (DESIGN §6; NIGHTLY_JOB §4 stage 4).
const CHECK_DAYS = 14;
const CHECK_RECORDINGS = 3;
const CHECK_HITS_TO_WORK = 2;

// Moments (DESIGN §5).
const MOMENT_MAX_S = 90;
const FICO_MOMENT_LEAD_S = 15;
const FICO_MOMENT_LEN_S = 45;

// Model stage (NIGHTLY_JOB §6, §7; COST §1).
const NIGHTLY_CAP_USD = 2.0;

module.exports = {
  PIPELINE_VERSION, SANDBOX_REF, PROD_REF, PROD_WRITES_ALLOWED, EXPECTED_REFS, CLIP_BUCKETS, SECTORS, TZ,
  MARGIN_TAIL_S, MARGIN_NOPLAN_EXIT_S, PRACTICE_SECONDS_PER_PRESCRIBED_MINUTE,
  DONE_VERDICTS, DONE_OR_PARTIAL_VERDICTS, NOT_DONE, SERIES_START, HISTORY_ONLY_GRADERS,
  FLOORS, SECTOR_MIN_COACHES_5PLUS, SECTOR_COACH_MIN_LESSONS, WINDOW_WEEKS,
  PRIORITY_MIN_SHARE, PRIORITY_MIN_TEACHERS, PRIORITY_SECTOR_MULTIPLE, HYSTERESIS_BAND, RANKING_HELD_OUT,
  CHECK_DAYS, CHECK_RECORDINGS, CHECK_HITS_TO_WORK, MOMENT_MAX_S, FICO_MOMENT_LEAD_S, FICO_MOMENT_LEN_S, NIGHTLY_CAP_USD,
};
