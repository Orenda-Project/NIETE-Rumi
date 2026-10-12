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
