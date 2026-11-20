"""Dump the data team's Slack Data-Analyst contract (prompt, tool schemas, refusal texts, compiled
tables) from a checkout of their repo, as one JSON file NIETE vendors. Usage:
  python3 vendor_contract.py <taleemabad-data-mcp checkout> > contract.json
Run with: uv run --no-project --with pyyaml --with pydantic --with structlog python3 vendor_contract.py <dir>"""
import json, subprocess, sys
from pathlib import Path
repo = Path(sys.argv[1])
sys.path.insert(0, str(repo / "src"))
from taleemabad_data_mcp.slackbot import tools as T
from taleemabad_data_mcp.slackbot import prompt as P
from taleemabad_data_mcp.slackbot import brain as B
from taleemabad_data_mcp.ontology.loader import get_program
from taleemabad_data_mcp.ontology.resolve import COMPILED_PROGRAMS

def compiled_tables():
    out = {}
    for name in COMPILED_PROGRAMS:
        program = get_program(name)
        for metric in getattr(program, "metrics", None) or []:
            tables = set()
            for d in metric.definitions:
                tables |= T._tables_in(d.sql or "")
            own = tables - T._SHARED_TABLES - {T._SCHEMA_VIEWS}
            out[metric.name] = sorted(set(out.get(metric.name, [])) | own)
    return out

version = (repo / "pyproject.toml").read_text().split('version = "', 1)[1].split('"', 1)[0]
commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
# EMAIL_DOMAIN_REJECTED_MESSAGE is left out: it speaks of "this Slack account" and lists the allowed mail
# domains, and NIETE's repo may not carry the org's domain (no-hardcoded-brand-urls). WhatsApp's own is in
# tool-proxy.js.
names = ["RULES_FIRST_REFUSAL", "UNGOVERNED_TABLE_REFUSAL", "COMPILED_FIRST_REFUSAL", "METRIC_ARGUMENTS_REFUSAL",
         "COMPILED_EXPORT_REFUSAL", "WITHHELD_PHONE_REFUSAL", "MCP_MISCONFIGURED_MESSAGE", "BOT_TOKEN_INVALID_MESSAGE",
         "ALREADY_FETCHED", "PRELOADED_RULES_HEADER", "WORD_MEANINGS_REPEATED"]
print(json.dumps({
    "source": {"repo": "taleemabad-data-mcp", "version": version, "commit": commit},
    "system_prompt": P.SYSTEM_PROMPT,
    "today_template": P._TODAY_TEMPLATE,
    "pick_one_set": P.PICK_ONE_SET,
    "week_starts_on": P._WEEK_STARTS_ON,
    "tool_schemas": T.TOOL_SCHEMAS,
    "texts": {n: getattr(T, n) for n in names},
    "brain": {k: getattr(B, k) for k in ["_TURN_CAP_NOTE", "_REFUSAL_NOTE", "_NO_ANSWER_NOTE", "_OUT_OF_ROOM_NOTE",
              "_TIME_CAP_NOTE", "_WRAP_UP_PROMPT", "_WRAP_UP_PROMPT_TIME", "_NOT_RUN", "_NOT_RUN_TIME", "_WRAP_UP_ACK"]},
    "auth_prefixes": {"misconfigured": T._MCP_MISCONFIGURED_PREFIX, "bot_token": T._BOT_TOKEN_INVALID_TEXT,
                      "email_domain": T._EMAIL_DOMAIN_REJECTED_PREFIX},
    "shared_tables": sorted(T._SHARED_TABLES),
    "compiled_programs": list(COMPILED_PROGRAMS),
    "compiled_tables": compiled_tables(),
}, indent=1, sort_keys=False, ensure_ascii=False))
