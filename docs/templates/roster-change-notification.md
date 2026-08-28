# Template to submit: `roster_teacher_removed_niete_v1`

Needed by the teacher add/remove feature (V1.2.2). **Not yet submitted.**

## Why a template and not a normal message

A coach who loses a teacher did not perform the change, so she is not in an
open conversation with the bot. Outside the 24-hour customer-service window
Meta drops free-form sends **silently** — the API returns success and nothing
arrives. Claiming "we told the other coaches" while that happens is worse than
not telling them, so this is a template or it is nothing.

The code is presence-gated on `ROSTER_CHANGE_TEMPLATE`: with the env var unset,
no send is attempted and the caller gets `notifyFailed` back rather than being
allowed to assume it worked.

## One template covers both cases

A move and a removal read the same from the losing coach's side — the teacher
is off her list, and the school named is the one she left. Two templates would
be two approval risks for one message.

| Case | `{{1}}` | `{{2}}` |
|---|---|---|
| Move (she went to another school) | teacher name | the school she **left** |
| Removal (off the school entirely)  | teacher name | the school she left |

## Submission

- **Name**: `roster_teacher_removed_niete_v1`
- **Category**: `UTILITY` — this is a change to a record the recipient owns, not
  marketing. Submitting it as MARKETING would be rejected and would also make it
  suppressible by the recipient's marketing opt-out.
- **Languages**: `en` and `ur` (both must be approved; `clampLanguage` resolves
  the coach's own language and the send picks the matching one)

### Body — `en`

```
{{1}} is no longer on your teacher list at {{2}}.

Her past observations and reports stay with you. Send /observe to see your current list.
```

### Body — `ur`

```
{{1}} اب {{2}} میں آپ کی ٹیچر فہرست میں شامل نہیں رہیں۔

ان کی پچھلی آبزرویشنز اور رپورٹس آپ کے پاس محفوظ ہیں۔ اپنی موجودہ فہرست دیکھنے کے لیے /observe بھیجیں۔
```

## Sample values for the review submission

Meta rejects variable-only templates and wants realistic samples:

- `{{1}}` → `Tahira Manzoor`
- `{{2}}` → `IMSG (I-X) Sangjani`

## After approval

1. Set `ROSTER_CHANGE_TEMPLATE=roster_teacher_removed_niete_v1` in the NIETE
   Railway env (staging first).
2. Confirm **both** language variants show `APPROVED`, not just `en` —
   `GET /{WABA_ID}/message_templates?fields=name,status,language`. A missing `ur`
   variant fails at send time for Urdu coaches only, which is the kind of gap
   that hides for weeks.
3. Consider adding it to `bot/scripts/setup/register-all-templates.js` so a fresh
   clone reproduces it. That file's tests assert the template count, so the
   count in `tests/setup/register-all-templates.test.js` moves 2 → 3.

## Known limitation

There is no notification for the teacher herself. She is not told that her
school changed, and `users.school_id` is updated under her. That is deliberate
for now — she never had visibility of her coach assignment — but it is worth a
decision before this reaches a market where teachers ask.
