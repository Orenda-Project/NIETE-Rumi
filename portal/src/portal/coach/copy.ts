/**
 * bd-o15qnr — every word the coach app v2 shows, in one place, so Urdu can
 * follow (language-protocol: NIETE is flat en/ur; read it before adding a
 * language). Names, schools and numbers are data and come from the API as they
 * are. Words stay short: icons plus 1–3 words, no sentences (v18 design).
 */

export const COACH_COPY = {
  greeting: (name?: string | null) => (name ? `Salaam, ${name}` : "Salaam"),
  coachChip: "Coach",
  home: "Home",
  back: "Back",
  loadFailed: "Could not load",
  retry: "Try again",
  dash: "—",

  // Home
  todaysVisits: "Today's visits",
  next: "Next",
  done: "Done",
  inHours: (h: number) => (h <= 0 ? "Now" : `In ${h} h`),
  takeObservation: "Take observation",

  // Features
  scheduling: "Scheduling",
  observe: "Observe",
  schoolsAndTeachers: "Schools & teachers",
  training: "Training",
  thisWeekN: (n: number) => `${n} this week`,
  waitingN: (n: number) => `${n} waiting`,
  inProgressN: (n: number) => `${n} in progress`,
  teachersN: (n: number) => `${n} teachers`,

  // Scheduling
  newVisit: "New visit",
  mySchedule: "My schedule",
  teamSchedule: "Team schedule",
  newVisitChip: "School · teacher · time",
  overdueN: (n: number) => `${n} overdue`,
  coachesN: (n: number) => `${n} coaches`,
  overdue: "Overdue",
  today: "Today",
  daysLate: (n: number) => `${n} days late`,

  // Team
  totals: { today: "Today", week: "This week", month: "This month" },
  coach: "Coach",
  allCoaches: "All coaches",
  you: "You",
  visitsN: (n: number) => `${n} visits`,
  showAllN: (n: number) => `Show all ${n}`,
  showFewer: "Show fewer",
  noVisits: "No visits",

  // New visit
  stepOf: (n: number) => `Step ${n} of 3`,
  pickSchool: "Pick a school",
  pickTeacher: "Pick a teacher",
  pickDayTime: "Pick day and time",
  sortedBySince: "Days since last visit",
  change: "Change",
  profile: "Profile",
  day: "Day",
  time: "Time",
  hour: "Hour",
  minutes: "Minutes",
  amPm: "AM / PM",
  laterHour: "Later hour",
  earlierHour: "Earlier hour",
  booked: "Booked",
  schedule: "Schedule",
  saving: "Saving",
  visitScheduled: "Visit scheduled",
  teachersCount: (n: number) => `${n} teachers`,
  lastVisitDays: (d: number | null) => (d == null ? "No visits yet" : `Last visit ${d} days`),
  reschedule: "Reschedule",

  // Observe
  takeObservationTile: "Take observation",
  reports: "Reports",
  pickTheTeacher: "Pick the teacher",
  scheduleFirst: "Schedule a visit first",
  recordLive: "Record live",
  attachRecording: "Attach recording",
  teacherProfile: "Teacher profile",
  lastVisit: "Last visit",
  cancel: "Cancel",
  cancelVisit: "Cancel visit",
  keepVisit: "Keep visit",
  hitlYou: "HITL",

  // Reports
  waitingForYou: "Waiting for you",
  inProgress: "In progress",
  allObservations: "All observations",
  stepLabel: { draft: "Check draft", talk: "Talk", analysing: "Analysing", sent: "Sent" } as Record<string, string>,
  steps: ["Analysed", "Draft", "Talk", "Sent"],
  showMore: "Show more",

  // Schools & teachers
  teachersTab: "Teachers",
  schoolsTab: "Schools",
  sort: "Sort",
  sortDays: "Days since visit",
  sortAvg: "Avg score",
  sortAz: "A–Z",
  sortLeast: "Least visited",
  sortMost: "Most visited",
  allSchools: "All schools",
  school: "School",
  visitsLast3: "Visits · last 3 months",
  sinceVisit: "Since visit",
  hitl: "HITL",
  dc: "DC",
  avg: "Avg",
  avgHitl: "Avg HITL",
  trainingCol: "Training",
  visitsCol: "Visits",
  teachersCol: "Teachers",
  scheduleVisitHere: "Schedule visit here",
  scheduleVisit: "Schedule visit",
  hitlVisits: "HITL visits",
  dcSessions: "DC sessions",
  modulesDone: "Modules done",
  lastTraining: "Last training",
  history: "History",
  nextVisitOn: (when: string) => `Next visit: ${when}`,
  searchPlaceholder: "Name or phone",
  schoolSearchPlaceholder: "School name",
  daysShort: (d: number | null) => (d == null ? "—" : `${d}d`),
  pct: (n: number | null) => (n == null ? "—" : `${Math.round(n * 10) / 10}%`),
};

export type CoachCopy = typeof COACH_COPY;
