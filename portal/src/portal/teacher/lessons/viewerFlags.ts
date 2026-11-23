import { useEffect, useState } from 'react';
import { peekConfig, readConfigShared } from '../../lib/useNewUi';

/**
 * The plan screen's switches, from GET /config's shared, cached read (no extra request). The first render takes the
 * answer this session already has, so the viewer does not change layout after it paints.
 *
 *   useViewerSlim       features.lpViewerSlim (portal_lp_viewer_slim): the slim row over the plan, Quiz this lesson and
 *                       Send on WhatsApp after it, no dock. On only for a real true; unread or failed = today's viewer.
 *   useLpWhatsappSend   features.lpWhatsappSend: her programme may get the plan's PDF on WhatsApp. Off only for a real
 *                       false (lp_whatsapp_pdf_off lists her programme), so a server without the field keeps today.
 */
type Features = Record<string, unknown> | undefined;

function useFeature(read: (f: Features) => boolean): boolean {
  const [on, setOn] = useState<boolean>(() => read(peekConfig()?.features as Features));
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(read(cfg?.features as Features)); })
      .catch(() => { if (live) setOn(read(undefined)); });
    return () => { live = false; };
  }, [read]);
  return on;
}

const slimOn = (f: Features) => f?.lpViewerSlim === true;
const sendAllowed = (f: Features) => f?.lpWhatsappSend !== false;

export const useViewerSlim = () => useFeature(slimOn);
export const useLpWhatsappSend = () => useFeature(sendAllowed);
