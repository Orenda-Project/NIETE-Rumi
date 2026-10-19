/**
 * Where a Reading Hour / Numeracy (FLN) plan opens: the deep-link route
 * (contracts/deep-link.md). Every list that reopens a used plan (Home, Recent, All lesson plans) and
 * every link a leader sends land here, so the plan page logs the open once, the same way.
 */
export const flnPlanPath = (id: string): string => `/portal/fln/p/${encodeURIComponent(id)}`;
