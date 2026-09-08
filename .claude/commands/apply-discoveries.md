# /apply-discoveries — fold approved E2E findings into the specs

Applies HUMAN-APPROVED discoveries + intended drift to the Gherkin specs. Gated:
acts only on `status: approved` / `verdict: intended`; never on `proposed`/`pending`.

Full procedure: [`.claude/skills/apply-discoveries/SKILL.md`](../skills/apply-discoveries/SKILL.md).

## Use
1. Triage a run's ledgers first (set `approved` / `intended` by hand).
2. Run `/apply-discoveries`.
3. Review the printed diffs; they still go through PR review.
