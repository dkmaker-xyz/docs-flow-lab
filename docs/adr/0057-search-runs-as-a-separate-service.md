---
id: ADR-0057
title: Search runs as a separate service
description: From v0.3.0 search is its own service.
intent: Where search runs from v0.3.0; read before changing search.
when: When you change search or its deployment.
state: accepted
category: architecture
relations:
  - type: supersedes
    target: ADR-0055
    why: search moves to its own service in v0.3.0
    link: ./0055-search-runs-in-the-app-process.md
  - type: relates-to
    target: TECH-0005
    why: the service uses the approved Node.js base image
    link: ../techstack/0005-node-js-base-image.md
---
## Context

Search inside the app process ([ADR-0055][ADR-0055]) cannot keep up with the larger indexes planned for v0.3.0.

## Decision

From v0.3.0, search runs as a separate service next to the app. The app calls it over HTTP. The service keeps its own index and is deployed with the same container base image as the app ([TECH-0005][TECH-0005]).

### Rollout

The service ships with v0.3.0; the in-process search is removed in the same release.

## Consequences

- One more service to deploy and monitor.
- The app no longer holds the search index in memory.

[ADR-0055]: ./0055-search-runs-in-the-app-process.md
[TECH-0005]: ../techstack/0005-node-js-base-image.md
