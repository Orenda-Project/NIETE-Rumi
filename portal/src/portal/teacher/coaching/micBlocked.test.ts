import { describe, it, expect } from "vitest";

/**
 * bd-qccbrv — ICT feedback (IAB Experience View, row 18), operator-approved mockup: the line under "Microphone blocked"
 * follows what actually happened, in her language.
 *   1  first refusal                         → tap Try again and allow the microphone (bd-idkgm2)
 *   2  the browser reports the mic blocked   → where to unblock it (🔒 next to the web address)
 *   3  Try again was refused again           → WhatsApp's browser: allow the mic for WhatsApp; elsewhere: in settings
 */

import { micBlockedLine } from "./micBlocked";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as U } from "./copy";

describe("micBlockedLine", () => {
  it("1 · first refusal", () => {
    expect(micBlockedLine({ browserBlocked: false, retried: false, inApp: false }, C)).toBe(C.micBlockedHint);
    expect(micBlockedLine({ browserBlocked: false, retried: false, inApp: true }, C)).toBe(C.micBlockedHint);
  });
  it("2 · the browser says it is blocked — wins, retried or not", () => {
    expect(micBlockedLine({ browserBlocked: true, retried: false, inApp: false }, C)).toBe(C.micBrowserBlocked);
    expect(micBlockedLine({ browserBlocked: true, retried: true, inApp: false }, C)).toBe(C.micBrowserBlocked);
  });
  it("3 · refused again: WhatsApp's browser names WhatsApp; anywhere else, the general line", () => {
    expect(micBlockedLine({ browserBlocked: false, retried: true, inApp: true }, C)).toBe(C.micStillBlockedWhatsApp);
    expect(micBlockedLine({ browserBlocked: false, retried: true, inApp: false }, C)).toBe(C.micStillBlocked);
  });
  it("the words, as approved — English and Urdu", () => {
    expect(C.micBrowserBlocked).toBe("Your browser has blocked the microphone. Click the 🔒 icon next to the web address, allow the microphone, then tap Try again.");
    expect(U.micBrowserBlocked).toBe("آپ کے براؤزر نے مائیک بند کر دیا ہے۔ ویب ایڈریس کے ساتھ 🔒 پر کلک کریں، مائیک کی اجازت دیں، پھر «دوبارہ کوشش کریں» دبائیں۔");
    expect(C.micStillBlockedWhatsApp).toBe("Still blocked? Allow the microphone for WhatsApp in your phone’s settings, or upload a recording instead.");
    expect(U.micStillBlockedWhatsApp).toBe("اب بھی بند ہے؟ فون کی سیٹنگز میں WhatsApp کو مائیک کی اجازت دیں، یا ریکارڈنگ اپ لوڈ کریں۔");
    expect(C.micStillBlocked).toBe("Still blocked? Allow the microphone in your browser or phone settings, or upload a recording instead.");
    expect(U.micStillBlocked).toBe("اب بھی بند ہے؟ براؤزر یا فون کی سیٹنگز میں مائیک کی اجازت دیں، یا ریکارڈنگ اپ لوڈ کریں۔");
  });
});
