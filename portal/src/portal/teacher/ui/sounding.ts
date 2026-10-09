/**
 * bd-4404s7.1 — ONE kit sound at a time: VoiceNote and AudioCard both claim the speaker here, so starting one pauses the other
 * (and nothing else: no microphone, no recording session). A player that unmounts releases it.
 */
let current: HTMLAudioElement | null = null;

export function claimSound(el: HTMLAudioElement): void {
  if (current && current !== el) current.pause();
  current = el;
}

export function releaseSound(el: HTMLAudioElement): void {
  if (current === el) current = null;
}
