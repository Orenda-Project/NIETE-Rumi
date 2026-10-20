import { describe, it, expect } from "vitest";
import { accountLoginFailure, loginFailure, resetFailure, verifyFailure } from "./errors";

/** bd-fmf24g.64 — the server's sentences become short in-app labels, by HTTP status (decision 3). No API change. */
describe("login failures, by status", () => {
  it.each([
    [401, { field: "password", key: "wrongPw" }],
    // bd-xxi78f: no password → set one (the login takes her to Forgot password); not registered → Register on
    // WhatsApp. Never "No password yet" / "No account found".
    [403, { field: "form", key: "setPw" }],
    [404, { field: "form", key: "notRegistered" }],
    [400, { field: "phone", key: "checkNum" }],
    [429, { field: "form", key: "tooMany" }],
    [0, { field: "form", key: "noConnection" }],
    [500, { field: "form", key: "couldntLogin" }],
    [200, { field: "form", key: "couldntLogin" }],
    [undefined, { field: "form", key: "couldntLogin" }],
  ])("%s", (status, want) => {
    expect(loginFailure(status as number | undefined)).toEqual(want);
  });
});

/**
 * bd-s6qbts.5 — an account NAME signs in on its own page (auth/AnalyticsLogin; bd-xxi78f took it off the phone login).
 * The server answers every way a name sign-in can be wrong with one 401 (so it never says whether the name exists), so
 * the page says the plain "Couldn't log in", never "Wrong password" under the password.
 */
describe("login failures for an account name", () => {
  it.each([401, 400, 403, 404, 500])("%s is 'Couldn't log in' under the button", (status) => {
    expect(accountLoginFailure(status)).toEqual({ field: "form", key: "couldntLogin" });
  });

  it.each([429, 0])("%s maps as it does for a phone", (status) => {
    expect(accountLoginFailure(status)).toEqual(loginFailure(status));
  });
});

describe("reset failures", () => {
  it.each([
    [404, { field: "form", key: "notRegistered" }],
    [400, { field: "phone", key: "checkNum" }],
    [429, { field: "form", key: "tooMany" }],
    [0, { field: "form", key: "noConnection" }],
    [500, { field: "form", key: "couldntSend" }],
  ])("send code, %s", (status, want) => expect(resetFailure(status)).toEqual(want));

  it.each([
    [400, { field: "code", key: "wrongCode" }],
    [429, { field: "form", key: "tooMany" }],
    [0, { field: "form", key: "noConnection" }],
    [500, { field: "form", key: "couldntReset" }],
  ])("verify, %s", (status, want) => expect(verifyFailure(status)).toEqual(want));
});
