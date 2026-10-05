/**
 * Did this module-quiz attempt complete the module? bd-zgme6.
 *
 * Mirrors the server, which writes teacher_training_progress only when the
 * attempt passed (bd-2450, dashboard/routes/portal.routes.js). The pass bar is
 * the vendor's and is applied by the bot; the portal only reads the verdict.
 * A page that ticks a module "Completed" off a failed attempt tells the
 * teacher something the database does not hold.
 */
export function completesModule(attempt: { is_passed: boolean }): boolean {
  return attempt.is_passed === true;
}
