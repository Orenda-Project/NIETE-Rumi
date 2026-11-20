/**
 * The team view "Where teachers get to" (spec §5) — English only, as the rest of Analytics. Its own file so the
 * analytics copy (already past the 300-line limit) does not grow.
 */
export const TEAM_JOURNEY_WORDS = {
  title: 'Where teachers get to',
  steps: {
    none: 'Nothing yet',
    plan_opened: 'Opened a lesson plan',
    taught: 'Taught in class',
    coached: 'DC observation',
    report: 'Read the report',
    quiz: 'Sent a quiz',
  } as Record<string, string>,
  stoppedHere: (n: number) => `Stopped here: ${n}`,
  teachers: 'Teachers',
  showMore: 'Show more',
  back: 'Back',
  noName: '—',
  updatedLastNight: 'Updated last night',
  updatedToday: (time: string) => `Updated today, ${time}`,
  updatedYesterday: (time: string) => `Updated yesterday, ${time}`,
  am: 'AM',
  pm: 'PM',
  today: 'Today',
  yesterday: 'Yesterday',
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
} as const;
