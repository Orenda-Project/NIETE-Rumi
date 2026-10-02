/**
 * bd-s1oo0.7 — the tone at 60 seconds. A short WebAudio beep (no file, no
 * permission) and a buzz where the phone can. Never throws: a phone that cannot
 * beep still shows "Time is up" in large type.
 */

type AudioCtor = typeof AudioContext;

export function playTone(env: { AudioContext?: AudioCtor; vibrate?: (p: number[]) => boolean } = {}): void {
  try {
    const Ctx: AudioCtor | undefined = env.AudioContext
      || (typeof window !== "undefined" ? (window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) : undefined);
    if (Ctx) {
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.4;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
      osc.onended = () => { try { void ctx.close(); } catch { /* closed */ } };
    }
  } catch { /* no audio output */ }
  try {
    const vibrate = env.vibrate || (typeof navigator !== "undefined" && navigator.vibrate ? navigator.vibrate.bind(navigator) : undefined);
    vibrate?.([300, 120, 300]);
  } catch { /* no vibration */ }
}
