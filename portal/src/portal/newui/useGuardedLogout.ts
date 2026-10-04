import { useAuth } from '../hooks/useAuth';
import { useLogoutGuard } from '../lib/recordingSession';

/**
 * bd-5rz1v.26.4 — Logout, from ANY new-UI component: the account sheet, the menu's pull-up panel
 * (bd-5rz1v.18), a tile anywhere.
 *
 *   const logout = useGuardedLogout();
 *   <Tile onClick={() => { closeYourSheet(); logout(); }} />
 *
 * Nothing recording: she is logged out at once. A lesson recording: the session asks "Stop
 * recording?" first (newui/coaching/LogoutWhileRecording, in the kit while portal_new_ui is on):
 * Keep recording changes nothing; Stop & log out keeps the recording on the phone, then logs out.
 * Use it inside a page (PortalLayout provides the signed-in user); close your own sheet first, so
 * the question is not stacked on it.
 */
export function useGuardedLogout(): () => void {
  const { logout } = useAuth();
  return useLogoutGuard(logout);
}
