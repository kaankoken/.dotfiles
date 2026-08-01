---
name: stack-gcp
description: On-demand Google Cloud pack router (google/skills cloud). Load on stack route/explicit ask — not cold-listed, no slash command.
---

# stack-gcp (on-demand pack)

Load this file by path `~/.omp/agent/skills/stack-gcp/SKILL.md` — not `skill://stack-gcp` (not cold-listed).

Cold start does **not** catalog google/skills. Activate only for GCP/cloud work.

## When to use

- Intent route `stack` with `stackId: gcp` / freeform Google Cloud work
- Explicit ask for gcloud / GKE / BigQuery / Cloud Run / etc.
- **Not** Play Billing or Android Engage (those are Android explicit-path skills)

## Install (if missing)

```bash
git clone https://github.com/google/skills \
  ~/.claude/plugins/marketplaces/google-skills
# pin: e08ada03c19b013861cc139b3e06d764afad0fd2 (update when refreshing)
```

Pack root (non-recursive):  
`~/.claude/plugins/marketplaces/google-skills/skills/cloud`

If that directory is missing: **say pack not installed** and print the clone command. **Never fake** skill bodies.

## Load order (live paths — never vendor bodies)

1. Prefer path `…/cloud/gcloud/SKILL.md` only if present in session catalog (e.g. pack-gcp overlay).
2. Otherwise read entry `SKILL.md` by absolute path:

```text
~/.claude/plugins/marketplaces/google-skills/skills/cloud/gcloud/SKILL.md
~/.claude/plugins/marketplaces/google-skills/skills/cloud/google-cloud-recipe-auth/SKILL.md
~/.claude/plugins/marketplaces/google-skills/skills/cloud/google-cloud-recipe-onboarding/SKILL.md
```

3. Pull further cloud skills by path as needed. Do not preload the full cloud set.

## Do not

- Register `/stack-gcp` slash command
- Assume gcp skills appear in cold `includeSkills`
- Treat Play Billing / Engage as GCP pack skills
