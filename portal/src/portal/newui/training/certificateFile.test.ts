import { describe, it, expect, vi } from "vitest";
import { downloadCertificate, type DownloadEnv } from "./certificateFile";

/**
 * bd-4ryvw — "Download certificate" must save the PDF without leaving the portal.
 *
 * The route 302s to a signed R2 url. In the app the WebView followed it to R2's host,
 * which is not in allowNavigation, so Capacitor gave it to Chrome. On the web the
 * button opened a new tab. Now the portal asks for the signed link (?format=json) and:
 *
 *   web           follows it IN PLACE: the url is Content-Disposition: attachment, so
 *                 the browser saves the file and the page stays where it is
 *   app (1217+)   hands it to the native CertificateFile plugin, which saves the PDF to
 *                 Downloads and opens it — Chrome is never involved
 *   older app     no plugin in the APK (OTA runs new web code on old APKs): the old
 *                 in-place navigation, unchanged
 */

const PATH = "/api/portal/training/certificates/NIETE-ASP-1/download";
const LINK = { url: "https://r2.example.com/c.pdf?X-Amz-Signature=x", filename: "NIETE-certificate-NIETE-ASP-1.pdf" };

function env(over: Partial<DownloadEnv> = {}): DownloadEnv & { followed: Array<[string, boolean]> } {
  const followed: Array<[string, boolean]> = [];
  return {
    native: false,
    plugin: null,
    getLink: vi.fn().mockResolvedValue(LINK),
    follow: (href: string, newTab: boolean) => { followed.push([href, newTab]); },
    resolve: (p: string) => `https://portal-sandbox.up.railway.app${p}`,
    followed,
    ...over,
  };
}

describe("bd-4ryvw — downloadCertificate", () => {
  it("web: fetches the signed link and follows it in place — never a new tab", async () => {
    const e = env();
    await expect(downloadCertificate(PATH, e)).resolves.toBe("saved");
    expect(e.getLink).toHaveBeenCalledWith(PATH);
    expect(e.followed).toEqual([[LINK.url, false]]);
  });

  it("app with the plugin: the plugin saves the file; nothing is navigated", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const e = env({ native: true, plugin: { save } });
    await expect(downloadCertificate(PATH, e)).resolves.toBe("saved");
    expect(save).toHaveBeenCalledWith({ url: LINK.url, filename: LINK.filename });
    expect(e.followed).toEqual([]);
  });

  it("older app without the plugin: the previous in-place navigation, on the API's origin", async () => {
    const e = env({ native: true, plugin: null });
    await expect(downloadCertificate(PATH, e)).resolves.toBe("saved");
    expect(e.getLink).not.toHaveBeenCalled();
    expect(e.followed).toEqual([[`https://portal-sandbox.up.railway.app${PATH}`, false]]);
  });

  it("a link that cannot be fetched is reported, and nothing is opened", async () => {
    const e = env({ getLink: vi.fn().mockRejectedValue(new Error("502")) });
    await expect(downloadCertificate(PATH, e)).resolves.toBe("failed");
    expect(e.followed).toEqual([]);
  });

  it("a plugin failure is reported rather than thrown", async () => {
    const e = env({ native: true, plugin: { save: vi.fn().mockRejectedValue(new Error("disk")) } });
    await expect(downloadCertificate(PATH, e)).resolves.toBe("failed");
  });
});
