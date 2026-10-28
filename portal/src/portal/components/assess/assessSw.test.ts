import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Round 8 (sa_r8_offline_prep): the Learning assessment page's own offline worker (public/assess-sw.js). Online it is
// the network's answer; offline the kept page, files and reads, so a tab the phone reloads at the school still opens.
// the worker is a classic script (the portal's .js files are ES modules): run it with a module object, as Node would
const SRC = readFileSync(path.resolve(__dirname, "../../../../public/assess-sw.js"), "utf8");
const mod: { exports: any } = { exports: {} };
vm.runInNewContext(SRC, { module: mod, URL, Response, Promise, setTimeout, clearTimeout });
const sw = mod.exports;
const O = "https://portal.test";

describe("assess-sw strategy", () => {
  it("answers the assessment pages, the hashed files and the portal's reads; never the test page, a POST or a session read", () => {
    expect(sw.strategyFor(`${O}/portal/leader/assess`, "GET", "navigate", O)).toBe("page");
    expect(sw.strategyFor(`${O}/portal/leader/assess/dashboard`, "GET", "navigate", O)).toBe("page");
    expect(sw.strategyFor(`${O}/portal/leader/home`, "GET", "navigate", O)).toBeNull();
    expect(sw.strategyFor(`${O}/assets/index-SnAtiAE6.js`, "GET", "no-cors", O)).toBe("asset");
    expect(sw.strategyFor(`${O}/api/portal/me`, "GET", "cors", O)).toBe("api");
    expect(sw.strategyFor(`${O}/api/portal/leader/child-test/sa/list?schoolId=s2`, "GET", "cors", O)).toBe("api");
    expect(sw.strategyFor(`${O}/api/portal/leader/child-test/sa/session/abc/status`, "GET", "cors", O)).toBeNull();
    expect(sw.strategyFor(`${O}/api/portal/leader/child-test/sa/outcome`, "POST", "cors", O)).toBeNull();
    expect(sw.strategyFor(`${O}/sa/play.html?s=1`, "GET", "navigate", O)).toBeNull();
    expect(sw.strategyFor(`${O}/sa/v1/ur/a.mp3`, "GET", "no-cors", O)).toBeNull();
    expect(sw.strategyFor("https://fonts.googleapis.com/css2", "GET", "no-cors", O)).toBeNull();
  });
});

const ok = (body: string) => new Response(body, { status: 200 });

describe("assess-sw networkFirst", () => {
  it("online: the network's answer, kept", async () => {
    const kept: Response[] = [];
    const r = await sw.networkFirst(() => Promise.resolve(ok("fresh")), () => Promise.resolve(ok("old")), 1000, (x: Response) => kept.push(x));
    expect(await r.text()).toBe("fresh");
    expect(kept).toHaveLength(1);
  });

  it("offline with a kept copy: the kept copy", async () => {
    const r = await sw.networkFirst(() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.resolve(ok("old")), 1000, () => {});
    expect(await r.text()).toBe("old");
  });

  it("a slow network with a kept copy: the kept copy after the wait", async () => {
    const t0 = Date.now();
    const r = await sw.networkFirst(() => new Promise(() => {}), () => Promise.resolve(ok("old")), 50, () => {});
    expect(await r.text()).toBe("old");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("offline with nothing kept: a 503, never a hang", async () => {
    const r = await sw.networkFirst(() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.resolve(undefined), 50, () => {});
    expect(r.status).toBe(503);
  });

  it("a server error: the kept answer when there is one, else the server's own; a 401 with nothing kept stays a 401", async () => {
    const e = await sw.networkFirst(() => Promise.resolve(new Response("x", { status: 502 })), () => Promise.resolve(ok("old")), 1000, () => {});
    expect(await e.text()).toBe("old");
    const f = await sw.networkFirst(() => Promise.resolve(new Response("no", { status: 401 })), () => Promise.resolve(undefined), 1000, () => {});
    expect(f.status).toBe(401);
  });
});
