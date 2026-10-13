import { describe, it, expect } from "vitest";
import { loginFailure, resetFailure, verifyFailure } from "./errors";

/** bd-fmf24g.64 — the server's sentences become short in-app labels, by HTTP status (decision 3). No API change. */
describe("login failures, by status", () => {
  it.each([
    [401, { field: "password", key: "wrongPw" }],
    [403, { field: "password", key: "noPw" }],
    [404, { field: "phone", key: "noAccount" }],
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
 * bd-s6qbts.5 — signing in with an account NAME. The server answers every way a name sign-in can be wrong with the
 * wrong-password 401 (so it never says whether the name exists). "Wrong password" under the password would point an
 * official who mistyped the NAME at the wrong field, so a name's 401 is the plain "Couldn't log in". Every other
 * status, and every phone, maps as before.
 */
describe("login failures for an account name", () => {
  it("a 401 is 'Couldn't log in' under the button, not 'Wrong password'", () => {
    expect(loginFailure(401, true)).toEqual({ field: "form", key: "couldntLogin" });
  });

  it.each([429, 0, 500])("%s maps as it does for a phone", (status) => {
    expect(loginFailure(status, true)).toEqual(loginFailure(status));
  });

  it("a phone's 401 is still 'Wrong password'", () => {
    expect(loginFailure(401, false)).toEqual({ field: "password", key: "wrongPw" });
  });
});

describe("reset failures", () => {
  it.each([
    [404, { field: "phone", key: "noAccount" }],
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
