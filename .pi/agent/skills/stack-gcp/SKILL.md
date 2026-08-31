---
name: stack-gcp
description: On-demand Google Cloud pack router (google/skills cloud + GCS). Load on stack route/explicit ask — not cold-listed, no slash command.
---

# stack-gcp (on-demand pack)

Load this file by path `~/.pi/agent/skills/stack-gcp/SKILL.md` — not `skill://stack-gcp` (not cold-listed).

Cold start does **not** catalog google/skills or GCS. Activate only for GCP/cloud work.

## When to use

- Intent route `stack` with `stackId: gcp` / freeform Google Cloud work
- Explicit ask for gcloud / GKE / BigQuery / Cloud Run / GCS / gcsfuse / etc.
- **Not** Play Billing or Android Engage (those are Android explicit-path skills)

## Install (if missing)

Clone into the dotfiles tree, then `stow .` so live paths exist under `~/.agents/`.

```bash
git clone https://github.com/google/skills \
  ~/.dotfiles/.agents/google-skills
# pin: e08ada03c19b013861cc139b3e06d764afad0fd2 (update when refreshing)

git clone https://github.com/gemini-cli-extensions/google-cloud-storage \
  ~/.dotfiles/.agents/google-cloud-storage
```

Pack roots (non-recursive, live):
`~/.agents/google-skills/skills/cloud`
`~/.agents/google-cloud-storage/skills`

If a needed directory is missing: **say pack not installed** and print the matching clone command. **Never fake** skill bodies.

## Load order (live paths — never vendor bodies)

1. Prefer path load only if present in session catalog (e.g. pack-gcp overlay).
2. Otherwise read entry `SKILL.md` by absolute path:

```text
~/.agents/google-skills/skills/cloud/gcloud/SKILL.md
~/.agents/google-skills/skills/cloud/google-cloud-recipe-auth/SKILL.md
~/.agents/google-skills/skills/cloud/google-cloud-recipe-onboarding/SKILL.md
```

3. GCS work: also read `~/.agents/google-cloud-storage/skills/google-cloud-storage-basics/SKILL.md`. Pull further `google-cloud-storage-*` by path as needed.
4. Pull further cloud skills by path as needed. Do not preload either pack.

## Do not

- Register `/stack-gcp` slash command
- Assume gcp skills appear in cold `includeSkills`
- Treat Play Billing / Engage as GCP pack skills
