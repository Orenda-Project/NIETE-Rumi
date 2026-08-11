#!/usr/bin/env python3
"""Wire env vars to all 5 staging Railway services.

Idempotent bootstrap: takes prod NIETE-Rumi bot's env vars as baseline, overrides
staging-specific values (Supabase, SQS, WhatsApp, URLs), adds required deploy
config, and upserts to each service via Railway variableCollectionUpsert GraphQL.

USAGE (from repo root):
  # Required env vars (source from your local .staging-bootstrap/secrets.env or vault):
  export RAILWAY_TOKEN=...                    # Railway account token
  export RAILWAY_STAGING_PROJECT_ID=...       # from staging Railway project
  export RAILWAY_STAGING_ENV_ID=...           # from staging Railway project
  export STAGING_WHATSAPP_TOKEN=...           # permanent WhatsApp token for App 4509630046027431
  export STAGING_DB_PASSWORD=...              # staging Supabase DB password
  export STAGING_WEBHOOK_VERIFY_TOKEN=...     # 32-hex random string
  
  # Also required: /tmp/prod-bot-vars.json (fetched via Railway GraphQL from prod bot service)
  
  python3 NIETE-Rumi/infrastructure/scripts/staging/wire-env.py
"""
import os

import json
import subprocess
import sys

RAILWAY_TOKEN = os.environ["RAILWAY_TOKEN"]
STAGING_PROJECT_ID = os.environ["RAILWAY_STAGING_PROJECT_ID"]
STAGING_ENV_ID = os.environ["RAILWAY_STAGING_ENV_ID"]

# Load prod env vars
with open("/tmp/prod-bot-vars.json") as f:
    prod = json.load(f)["data"]["variables"]

# Load staging secrets
staging_secrets = {}
with open("/Users/mashhoodr/dev/rumi/Rumi 10 April 2026/NIETE-Rumi/.staging-bootstrap/secrets.env") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"): continue
        if "=" not in line: continue
        k, v = line.split("=", 1)
        staging_secrets[k] = v

# Load prod NIETE bot .env for WHATSAPP scoped items (prod NIETE uses Mudareb WABA, we override)
# The staging WhatsApp creds are already in staging_secrets, but for the raw phone_number_id etc.
# they were provided by user; we hard-code them here as the source of truth (also in credentials doc)

STAGING_WHATSAPP = {
    "PHONE_NUMBER_ID": "1223947620805697",
    "WABA_ID": "2019470752271014",
    "WHATSAPP_TOKEN": os.environ["STAGING_WHATSAPP_TOKEN"],
    "WEBHOOK_VERIFY_TOKEN": staging_secrets["STAGING_WEBHOOK_VERIFY_TOKEN"],
    "META_APP_ID": "4509630046027431",
}

STAGING_SUPABASE = {
    "SUPABASE_URL": staging_secrets["SUPABASE_URL"],
    "SUPABASE_ANON_KEY": staging_secrets["SUPABASE_ANON_KEY"],
    "SUPABASE_SERVICE_ROLE_KEY": staging_secrets["SUPABASE_SERVICE_ROLE_KEY"],
    "SUPABASE_DB_PASSWORD": staging_secrets["STAGING_DB_PASSWORD"],
    "DATABASE_URL": f"postgresql://postgres.rpqkekcfvumypldbejhp:{os.environ["STAGING_DB_PASSWORD"]}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres",
}

STAGING_SQS = {k: v for k, v in staging_secrets.items() if k.startswith("SQS_")}

STAGING_URLS = {
    "APP_URL": staging_secrets["RAILWAY_BOT_URL"],
    "BOT_DOMAIN": "bot-production-67c2.up.railway.app",
    "DASHBOARD_URL": staging_secrets["RAILWAY_DASHBOARD_URL"],
    "PORTAL_URL": staging_secrets["RAILWAY_PORTAL_URL"],
    "ASSESSMENT_GEN_CALLBACK_URL": f"{staging_secrets['RAILWAY_BOT_URL']}/webhook",
}

STAGING_REDIS = {
    "REDIS_URL": "redis://redis.railway.internal:6379",
}

STAGING_DEPLOY = {
    "NIXPACKS_NODE_VERSION": "22",
    "RAILPACK_NODE_VERSION": "22",
    "NODE_ENV": "staging",
    "DEFAULT_REGION": "niete-staging",  # tags every DB row as staging-region
    "BOT_NAME": "NIETE Staging",
}

# Compose final env: prod baseline, then override
final_env = dict(prod)
for override_group in [STAGING_WHATSAPP, STAGING_SUPABASE, STAGING_SQS, STAGING_URLS, STAGING_REDIS, STAGING_DEPLOY]:
    final_env.update(override_group)

# Strip prod-only keys that shouldn't leak to staging
STRIP_KEYS = [
    # Nothing critical to strip — DEFAULT_REGION already overridden
]
for k in STRIP_KEYS:
    final_env.pop(k, None)

print(f"Final staging env: {len(final_env)} vars")
print(f"  Overrides applied:")
for group_name, group in [("WhatsApp", STAGING_WHATSAPP), ("Supabase", STAGING_SUPABASE),
                          ("SQS", STAGING_SQS), ("URLs", STAGING_URLS),
                          ("Redis", STAGING_REDIS), ("Deploy", STAGING_DEPLOY)]:
    print(f"    {group_name}: {len(group)} keys")

# Upsert to each of the 5 code services
SERVICES = {
    "bot": staging_secrets["RAILWAY_BOT_SVC"],
    "sqs-worker": staging_secrets["RAILWAY_WORKER_SVC"],
    "sqs-worker-video": staging_secrets["RAILWAY_VIDEO_WORKER_SVC"],
    "dashboard": staging_secrets["RAILWAY_DASHBOARD_SVC"],
    "portal": staging_secrets["RAILWAY_PORTAL_SVC"],
}

def upsert(svc_name, svc_id, variables):
    """Upsert a variable collection to a service using variableCollectionUpsert."""
    payload = {
        "query": "mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
        "variables": {
            "input": {
                "projectId": STAGING_PROJECT_ID,
                "environmentId": STAGING_ENV_ID,
                "serviceId": svc_id,
                "variables": variables,
                "replace": True,
            }
        }
    }
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "https://backboard.railway.com/graphql/v2",
         "-H", f"Authorization: Bearer {RAILWAY_TOKEN}",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(payload)],
        capture_output=True, text=True
    )
    r = json.loads(result.stdout)
    if "errors" in r:
        print(f"  {svc_name}: ERROR - {json.dumps(r['errors'])[:250]}")
        return False
    else:
        print(f"  {svc_name}: OK ({len(variables)} vars)")
        return True

print(f"\nUpserting env vars to {len(SERVICES)} services...")
for svc_name, svc_id in SERVICES.items():
    upsert(svc_name, svc_id, final_env)
