/**
 * bd-pw1ccr.26 — the teacher Home's "Make my paper" card (notices/TopicPaperCard.tsx; switch
 * topic_nudge_portal_card_enabled, OFF by default): shown while her topic-end nudge waits for WhatsApp's window.
 * Both languages from day one (language-protocol: NIETE is flat en/ur), gender-neutral (the Urdu uses نے, so the
 * verb agrees with the lesson, not the teacher). Western digits in Urdu too, as the bot (vocabulary.guard.test.ts); the topic name is data in either
 * script, so it is first-strong isolated (§9.2). The Urdu awaits the same human review as the rest.
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

const fsi = (s: string) => `⁨${s}⁩`;

export const TOPIC_PAPER_COPY = {
  title: 'Time for a paper',
  body: (chapter: number) => `You finished a topic in chapter ${chapter}. Make a paper on it for your class.`,
  bodyTopic: (topic: string, chapter: number) => `You finished ${topic} in chapter ${chapter}. Make a paper on it for your class.`,
  cta: 'Make my paper',
} as const;

export const TOPIC_PAPER_COPY_UR = {
  title: 'پرچے کا وقت',
  body: (chapter: number) => `آپ نے باب ${chapter} کا ایک سبق مکمل کیا۔ اس پر اپنی کلاس کے لیے پرچہ بنائیں۔`,
  bodyTopic: (topic: string, chapter: number) => `آپ نے باب ${chapter} کا سبق ${fsi(topic)} مکمل کیا۔ اس پر اپنی کلاس کے لیے پرچہ بنائیں۔`,
  cta: 'پرچہ بنائیں',
};

export const TOPIC_PAPER = bilingual(TOPIC_PAPER_COPY, TOPIC_PAPER_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry finds ./topicpaper/copy.ts). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Home (make my paper)',
  module: TOPIC_PAPER as Bilingual<unknown>,
  longOk: ['body', 'bodyTopic'],
};
