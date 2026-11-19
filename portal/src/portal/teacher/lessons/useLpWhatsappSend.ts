import { useEffect, useState } from 'react';
import { readConfigShared } from '../../lib/useNewUi';

/**
 * May the plan screen show Send on WhatsApp? GET /config features.lpWhatsappSend, the shared cached read: false only
 * when her programme's lesson-plan PDF is off on WhatsApp (lp_whatsapp_pdf_off). null while /config is read; anything
 * but a real false — true, no field, a failed read — is true, which is today. POST /share/whatsapp checks again.
 */
export function useLpWhatsappSend(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.lpWhatsappSend !== false); })
      .catch(() => { if (live) setOn(true); });
    return () => { live = false; };
  }, []);
  return on;
}
