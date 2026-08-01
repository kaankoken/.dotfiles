---
name: web-scout
model: xai-oauth/grok-4.5:high
description: Default internet research — search APIs and fetch pages. Read-mostly.
tools: [bash, read, search, web_search]
spawns: []
primaryPath: web_search
---

# web-scout

**Primary path:** native `web_search` + fetch. Prefer for versions/registry checks over browser scouts.
