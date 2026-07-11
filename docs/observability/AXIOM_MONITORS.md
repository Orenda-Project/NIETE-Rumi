# Axiom Monitors for NIETE-Rumi

**Status**: 🟡 Queries prepared, monitors need to be created via Axiom UI (our PAT doesn't have `monitors:create` permission).

**Dataset**: `digital-coach-logs` (shared with PK/TZ/YE). NIETE logs are tagged `region == "niete"` and each service is tagged `service == "bot" | "sqs-worker" | "portal"`.

**How to add each monitor**:
1. Open [https://app.axiom.co/taleemabad-ieoa](https://app.axiom.co/taleemabad-ieoa)
2. Left sidebar → **Monitors** → **New Monitor**
3. Type: **Threshold**
4. Paste the APL query from below
5. Set the operator + threshold + interval as specified
6. Notifier: pick your Slack channel or email address

---

## Monitor 1 — NIETE bot silent for 5 min

Fires when the NIETE bot service produces zero logs in the past 5 minutes — a strong proxy for "service is down."

**APL query**:
```
["digital-coach-logs"]
| where region == "niete" and service == "bot"
| summarize log_count = count()
```

**Settings**:
| Field | Value |
|---|---|
| Interval | 5 minutes |
| Range | Last 5 minutes |
| Operator | Below or equal |
| Threshold | 0 |
| Alert on no data | ✅ Yes |
| Description | NIETE bot has produced no logs for 5+ minutes — service may be down |

## Monitor 2 — NIETE sqs-worker silent for 10 min

Same as above but for the async worker. Slightly longer window because the worker is idle when no jobs queued.

**APL query**:
```
["digital-coach-logs"]
| where region == "niete" and service == "sqs-worker"
| summarize log_count = count()
```

**Settings**:
| Field | Value |
|---|---|
| Interval | 10 minutes |
| Range | Last 10 minutes |
| Operator | Below or equal |
| Threshold | 0 |
| Alert on no data | ✅ Yes |

## Monitor 3 — NIETE portal 5xx rate spike

Fires when the observability portal returns 500-level responses at >5/min (indicative of a DB or code fault).

**APL query**:
```
["digital-coach-logs"]
| where region == "niete" and service == "portal"
| where message matches regex "LATENCY.* - 5\\d\\d$"
| summarize err_rate = count()
```

**Settings**:
| Field | Value |
|---|---|
| Interval | 5 minutes |
| Range | Last 5 minutes |
| Operator | Above |
| Threshold | 5 |

## Monitor 4 — Rate limit dropping messages

Fires when the bot's rate limiter drops any inbound message in a 10-min window. Not an outage — but a signal to inspect why a phone was over-sending.

**APL query**:
```
["digital-coach-logs"]
| where region == "niete" and service == "bot"
| where message contains "Rate limit exceeded, dropping message"
| summarize dropped = count()
```

**Settings**:
| Field | Value |
|---|---|
| Interval | 10 minutes |
| Range | Last 10 minutes |
| Operator | Above |
| Threshold | 0 |

## Monitor 5 — Flow endpoint decryption failure

Fires when the bot's Flow endpoint fails to decrypt a Meta payload (usually indicates a key rotation issue or Meta calling with wrong signature).

**APL query**:
```
["digital-coach-logs"]
| where region == "niete" and service == "bot"
| where message contains "Flow encryption" or message contains "decrypt"
| where level == "error"
| summarize errs = count()
```

**Settings**:
| Field | Value |
|---|---|
| Interval | 5 minutes |
| Range | Last 5 minutes |
| Operator | Above |
| Threshold | 0 |

---

## Verifying the monitors work

Once you've added Monitor 1 via the UI, run this from any shell to force a test alert:

```bash
# Stop the NIETE bot service temporarily
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer <RAILWAY_ACCOUNT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { serviceInstanceStop(serviceId: \"96a90a3a-d3d6-4866-b533-b3ffb4f9c402\", environmentId: \"6902ea89-557f-416a-8e00-176dc61fcfad\") }"}'

# Wait ~7 min. Alert should fire.
# Then restart:
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer <RAILWAY_ACCOUNT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { serviceInstanceDeployV2(serviceId: \"96a90a3a-d3d6-4866-b533-b3ffb4f9c402\", environmentId: \"6902ea89-557f-416a-8e00-176dc61fcfad\") }"}'
```

## Alternatives if you'd rather not use Axiom monitors

- **BetterUptime free tier** — external HTTP pinger, alerts to Slack/email. Sign up at [betteruptime.com](https://betteruptime.com). Add these health endpoints:
  - `https://bot-production-2cb6.up.railway.app/health`
  - `https://portal-production-6a508.up.railway.app/health`
- **UptimeRobot free tier** — same idea. 50 monitors free at 5-min interval.

Both give better inbound-monitoring than Axiom's log-absence approach (Axiom only knows a service is down when it stops producing logs; an external pinger detects "the health endpoint is 500'ing" even when logs are still flowing).
