import { describe, it, expect } from "vitest";
import { accountNameOf, isAccountName, isValidPkMobile, normalizePkMobile } from "./phone";

/**
 * bd-s6qbts.5 — the sign-in field takes a phone OR, for an analytics-only account, an account NAME.
 *
 * A name is told apart by holding an ASCII letter (no phone form does), the client mirror of isAccountNameInput in
 * dashboard/lib/analytics-account-name.js. Whether the name is real and allowed is the server's decision alone; the
 * client only stops asking a name to be 11 digits long.
 */
describe("isAccountName — a letter makes it a name", () => {
  it.each(["fde-islamabad", "FDE", " fde ", "sector-g9", "0300l234567"])("%p is a name", (input) => {
    expect(isAccountName(input)).toBe(true);
  });

  it.each(["03001234567", "0300 1234567", "+92 300 1234567", "0092-300-1234567", "", "   ", "فون"])(
    "%p is not a name",
    (input) => {
      expect(isAccountName(input)).toBe(false);
    },
  );
});

describe("the phone checks are unchanged", () => {
  it("still accepts every PK mobile form and still rejects a dropped digit", () => {
    for (const ok of ["03001234567", "0300 1234567", "+92 300 1234567", "923001234567", "3001234567"]) {
      expect(isValidPkMobile(ok)).toBe(true);
    }
    for (const bad of ["0300 123456", "12345", "", "fde-islamabad"]) expect(isValidPkMobile(bad)).toBe(false);
    expect(normalizePkMobile("0300 1234567")).toBe("923001234567");
  });
});

describe("accountNameOf — the name inside a stored analytics:<name>", () => {
  it("reads the name out of the reserved value", () => {
    expect(accountNameOf("analytics:fde-islamabad")).toBe("fde-islamabad");
  });

  it.each(["923001234567", "", "analytics:", "xanalytics:fde"])("%p is not one", (stored) => {
    expect(accountNameOf(stored)).toBeNull();
  });
});
