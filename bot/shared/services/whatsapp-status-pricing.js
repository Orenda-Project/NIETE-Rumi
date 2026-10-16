/**
 * WhatsApp cost by teacher (bd-v0toag.65).
 *
 * Meta puts the price of every delivered message on its status webhook
 * (`statuses[].pricing.{billable,category,pricing_model,type}`). This logs one
 * `whatsapp.status.priced` event per delivered/read status, keyed by users.id so
 * the v10 tracker can sum cost by A/B group. Never logs the phone, never creates
 * a user, never throws.
 */
const supabase = require('../config/supabase');
const { logEvent } = require('../utils/structured-logger');
const validators = require('../utils/validators');

const PRICED_STATUSES = new Set(['delivered', 'read']);

/** Pure: the priced fields of one status, or null when it is not a priced delivered/read status. */
function pricedFields(status) {
  if (!status || !PRICED_STATUSES.has(status.status) || !status.pricing) return null;
  const p = status.pricing;
  return {
    wamid: status.id,
    status: status.status,
    billable: p.billable,
    category: p.category,
    pricingModel: p.pricing_model,
    pricingType: p.type,
    phone: status.recipient_id,
  };
}

async function userIdsByPhone(phones) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, phone_number')
      .in('phone_number', phones)
      .is('deleted_at', null);
    if (error || !data) return new Map();
    return new Map(data.map((u) => [u.phone_number, u.id]));
  } catch {
    return new Map();
  }
}

async function logPricedStatuses(statuses, { phoneNumberId } = {}) {
  try {
    if (!validators.isOurPhoneNumber(phoneNumberId)) return;
    const priced = (statuses || []).map(pricedFields).filter(Boolean);
    if (!priced.length) return;
    const ids = await userIdsByPhone([...new Set(priced.map((p) => p.phone))]);
    for (const { phone, ...fields } of priced) {
      logEvent('whatsapp.status.priced', { userId: ids.get(phone), ...fields });
    }
  } catch {
    // Cost logging must never break the webhook.
  }
}

/** The /webhook status branch: broadcast delivery tracking and pricing, neither blocks the other. */
async function handleStatusWebhook(statusValidation, handleBroadcastStatusWebhook) {
  await Promise.allSettled([
    handleBroadcastStatusWebhook(statusValidation.statuses),
    logPricedStatuses(statusValidation.statuses, statusValidation),
  ]);
}

module.exports = { pricedFields, logPricedStatuses, handleStatusWebhook };
