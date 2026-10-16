import { browserEnv } from '@/lib/runtime';
import { portal } from '../../services/api';
import { downloadArtifact, openFile, type DownloadResult } from '../../newui/assessment/assessmentApi';
import { handoffIntentUrl } from '../ui/ShareActions';

/**
 * A board-pattern paper's file rows (Ready, the paper page): the question paper or the marking scheme, each its OWN file.
 * Inside WhatsApp's browser on Android a download often does nothing, so the row hands its file to the phone's browser
 * through the kit's hand-off page (`handoffIntentUrl`, the same route the dock's "Open in another app" takes). Everywhere
 * else (Chrome, Safari, the app, and WhatsApp on iPhone, where intent:// does not exist) it downloads as it always has;
 * so does a file on a host the hand-off page does not forward to.
 */
export async function openArtifact(paperId: string, artifact: 'paper' | 'answer_key'): Promise<DownloadResult> {
  if (browserEnv() !== 'android-iab') return downloadArtifact(paperId, artifact);
  try {
    const res = await portal.getAssessmentDownload(paperId, artifact);
    if (!res?.available || !res.url) return 'unavailable';
    const to = handoffIntentUrl(res.url, new URL(window.location.href).origin);
    if (to) window.location.href = to;
    else openFile(res.url);
    return 'opened';
  } catch {
    return 'failed';
  }
}
