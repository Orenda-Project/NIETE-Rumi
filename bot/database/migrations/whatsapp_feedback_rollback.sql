-- Migration rollback for whatsapp_feedback.sql.
-- destructive: reviewed. Drops the WhatsApp /feedback and /bug table and every report in it. Export the rows first if
-- any were sent; nothing else references this table. Switch WHATSAPP_FEEDBACK off first, or the next report fails.

DROP TABLE IF EXISTS public.whatsapp_feedback;
