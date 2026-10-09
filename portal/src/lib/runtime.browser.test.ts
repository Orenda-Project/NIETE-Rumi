import { describe, it, expect } from "vitest";
import { classifyBrowser } from "./runtime";

/** bd-fmf24g.30 — where a page runs decides what "Open in another app" does. The Capacitor WebView must NEVER read as WhatsApp's browser. */
const UA = {
  // The NIETE app: a plain Android WebView ("; wv)"), like WhatsApp's own browser, which is why `native` is checked first.
  capacitorWebView: "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36",
  whatsappAndroid: "Mozilla/5.0 (Linux; Android 13; Redmi Note 11 Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 WhatsApp/2.24.20.85",
  whatsappAndroidTagOnly: "Mozilla/5.0 (Linux; Android 12; vivo 2007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 WA4A/2.24.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36",
  samsungInternet: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  webViewIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

describe("classifyBrowser", () => {
  it("the Capacitor app is native, even though its WebView user agent says '; wv)'", () => {
    expect(classifyBrowser(UA.capacitorWebView, true)).toBe("native");
  });
  it("the same WebView user agent WITHOUT the app is WhatsApp's browser on Android", () => {
    expect(classifyBrowser(UA.capacitorWebView, false)).toBe("android-iab");
  });
  it("WhatsApp's own tags are android-iab, WebView or not", () => {
    expect(classifyBrowser(UA.whatsappAndroid, false)).toBe("android-iab");
    expect(classifyBrowser(UA.whatsappAndroidTagOnly, false)).toBe("android-iab");
  });
  it("Chrome, Samsung Internet and a desktop are plain browsers", () => {
    expect(classifyBrowser(UA.chromeAndroid, false)).toBe("browser");
    expect(classifyBrowser(UA.samsungInternet, false)).toBe("browser");
    expect(classifyBrowser(UA.desktop, false)).toBe("browser");
  });
  it("iPhone: a web view (no Safari token) is ios-iab; Safari and Chrome are browsers", () => {
    expect(classifyBrowser(UA.webViewIos, false)).toBe("ios-iab");
    expect(classifyBrowser(UA.safariIos, false)).toBe("browser");
    expect(classifyBrowser(UA.chromeIos, false)).toBe("browser");
  });
  it("no user agent is a browser", () => {
    expect(classifyBrowser("", false)).toBe("browser");
    expect(classifyBrowser(null, false)).toBe("browser");
  });
});
