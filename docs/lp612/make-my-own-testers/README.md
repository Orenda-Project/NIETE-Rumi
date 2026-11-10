# Make my own — testers on NIETE sandbox (bd-8kxvg5, queue #43)

Operator, 9-10 Nov: "i want ppl to test it on the sandbox" / "can we not setup a test number for them?"

## Shared portal login (no phone needed)

The NIETE portal signs in with **number + password** (bd-xxi78f), not a WhatsApp code, so a shared login is
just a sandbox teacher with a known password. No new login code was added.

| | |
|---|---|
| Portal | https://portal-sandbox.up.railway.app/portal/login (`/login` is a 404) |
| Number | 0311 999 0043 (not a real person's account; sandbox user `2fc73d8d…`) |
| Password | in the operator's tester guide (this repo is public, so not here) |
| Profile | ICT teacher, grades 3 + 6-8, "SIM — Child Test School (simulation)", Grade 3 + Grade 6 classes, `is_test_user`, Make my own on |

Never tap "Forgot password" on it: that sends a WhatsApp code to 0311 999 0043.

Checked 10 Nov on sandbox: sign-in, G3 Math chapter 1 → Make my own → Which day? → five questions → a real
plan in ~2 min (`g3-math-plan-ready.png`); G6 English chapter 2 shows Make my own first.

## WhatsApp hand-off needs the tester's OWN number

The bot answers whoever wrote to it, so the shared number cannot be used on WhatsApp. To let a tester try
the WhatsApp door (sandbox bot +92 302 5502255, "Digital Coach Updates"), add their number — one command,
from the NIETE-Rumi checkout:

```bash
railway run -p 0aef0655-1f90-4aab-9cca-e4daec46f2b4 -e sandbox -s bot \
  node bot/scripts/onboarding/sandbox-tester.js --phone 03XXXXXXXXX --name "Their name"
```

It makes (or updates) that number as the same ICT test teacher, test user, Make my own on. Add
`--password Something1` to also give them their own portal login. Run it again any time: nothing duplicates.
It refuses to run unless `RAILWAY_ENVIRONMENT_NAME=sandbox` AND `SUPABASE_URL` is the sandbox project
(`bot/shared/services/sandbox-tester.js` `assertSandbox`, pinned by `bot/tests/onboarding/sandbox-tester.test.js`).

Note: an existing sandbox account on that number is switched to this ICT profile (region, grades, school).

## Seen while testing

Once, G3 Math's Make my own step 1 showed "Nothing yet": `/api/portal/curriculum/lps` answered
`{"lessons":[]}` for a few calls (1 in the browser, 3 in a row by curl ~04:05Z) and 10 lessons on every other
call (40+). Reloading fixed it. Cause not found; follow-up bd-mg0vld.
