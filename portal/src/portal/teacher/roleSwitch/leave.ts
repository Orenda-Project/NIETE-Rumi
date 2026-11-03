/**
 * bd-tacnwy — where the app goes after a profile-type switch: a full load of /portal, so the new role is read from
 * scratch (the frontend reads users.role once, from /dashboard). Its own object so a test can watch it.
 */
export const leave = {
  to: (path: string) => { window.location.assign(path); },
};
