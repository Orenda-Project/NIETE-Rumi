'use strict';
/**
 * WHICH ROLE THE REGISTRATION FORM MAY GIVE — the one switch (bd-3goqc0, bd-x7aprz.2).
 *
 * The operator, 2026-10-16: a person registering on WhatsApp may call herself a Teacher or a
 * Principal, and nothing else. Coach and AEO are given by an admin (a roster, the /observe
 * admin), never by the form. A Principal is granted directly — the operator weighed making it a
 * request and decided against it the same day — even though picking a school as Principal
 * opens that school's My Patch (leader-patch.service.js PRINCIPAL_PATCH_SQL).
 *
 * Every place the form writes users.role goes through roleToWrite(): the per-screen write in
 * registration-endpoint.js (v4 PROFESSIONAL_INFO and v5 ROLE_SCHOOL) and the terminal write in
 * flow-response.handler.js. To change what the form may grant, change FORM_ROLES here and
 * nothing else — the dropdown (registration-data.js ROLES_DROPDOWN) is derived from it.
 */

/** The roles a person may give herself on the registration form, in the order offered. */
const FORM_ROLES = Object.freeze(['teacher', 'principal']);

/** Roles only an admin sets. The form never changes them, whatever it is sent. */
const ADMIN_ROLES = Object.freeze(['coach', 'aeo']);

const clean = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** The submitted role if the form may grant it, else null. */
function formRole(raw) {
  const v = clean(raw);
  return FORM_ROLES.includes(v) ? v : null;
}

/** True when the account's current role was set by an admin and the form must leave it alone. */
function isAdminRole(existingRole) {
  return ADMIN_ROLES.includes(clean(existingRole));
}

/**
 * The role to write for this submission, or null to write none.
 * @param {*} submitted what the form sent
 * @param {*} existingRole users.role as it stands
 */
function roleToWrite(submitted, existingRole) {
  if (isAdminRole(existingRole)) return null;
  return formRole(submitted);
}

module.exports = { FORM_ROLES, ADMIN_ROLES, formRole, isAdminRole, roleToWrite };
