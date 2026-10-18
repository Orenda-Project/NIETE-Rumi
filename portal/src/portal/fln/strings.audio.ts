/**
 * Every word the FLN sound controls show or speak (contracts/player.md v2, AUDIO_BAR A6/A10). EN + Urdu, one place.
 * Components never compose language-specific text themselves: they call the helpers below.
 */
export const AUDIO_STRINGS = {
  en: {
    gridTitle: 'Sounds in this lesson',
    loading: 'Loading…',
    playing: 'Playing…',
    error: "Couldn't play. Tap to try again",
    iosHint: 'No sound? Check the silent switch and volume',
    listenStory: 'Listen to the story',
    play: 'Play',
    stop: 'Stop',
  },
  ur: {
    gridTitle: 'اس سبق کی آوازیں',
    loading: 'لوڈ ہو رہا ہے…',
    playing: 'چل رہی ہے…',
    error: 'آواز نہیں چلی۔ دوبارہ کوشش کریں',
    iosHint: 'آواز نہیں؟ سائلنٹ سوئچ اور والیوم دیکھیں',
    listenStory: 'کہانی سنیں',
    play: 'چلائیں',
    stop: 'روکیں',
  },
} as const;

export type AudioLang = keyof typeof AUDIO_STRINGS;
export type AudioStrings = (typeof AUDIO_STRINGS)[AudioLang];

/** The strings for a plan language; anything that is not Urdu reads English. */
export function audioLang(lang?: string): AudioLang {
  return lang && lang in AUDIO_STRINGS ? (lang as AudioLang) : 'en';
}

export function audioStrings(lang?: string): AudioStrings {
  return AUDIO_STRINGS[audioLang(lang)];
}

/** Text direction of each plan language (the plan's own `dir` wins when it has one). */
const DIRS: Record<AudioLang, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl' };

export function audioDir(lang?: string, dir?: string): string {
  return dir || DIRS[audioLang(lang)];
}

/** Word order of "<action> <label>" per language: English "Play ب", Urdu «ب چلائیں» (the verb comes last). */
const ACTION_ORDER: Record<AudioLang, (action: string, label: string) => string> = {
  en: (action, label) => `${action} ${label}`,
  ur: (action, label) => `${label} ${action}`,
};

/** The line a control shows for its state; `undefined` when idle (the caption shows instead). */
export function audioStateText(lang: string | undefined, state: 'idle' | 'loading' | 'playing' | 'error'): string | undefined {
  if (state === 'idle') return undefined;
  return audioStrings(lang)[state];
}

/** The action a tap performs in a state: a playing or loading control stops; idle and error (retry) play. */
export function audioActionFor(state: 'idle' | 'loading' | 'playing' | 'error'): 'play' | 'stop' {
  return state === 'playing' || state === 'loading' ? 'stop' : 'play';
}

/** The accessible name of a sound control: what tapping it will do, and what it plays. */
export function audioActionLabel(lang: string | undefined, action: 'play' | 'stop', label: string): string {
  const key = audioLang(lang);
  return ACTION_ORDER[key](AUDIO_STRINGS[key][action], label);
}
