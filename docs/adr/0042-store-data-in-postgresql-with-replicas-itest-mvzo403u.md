---
id: ADR-0042
title: Store data in PostgreSQL with replicas itest-mvzo403u
description: Adds read replicas.
intent: Where service data is stored, now with replicas.
when: When a change stores or reads data.
state: accepted
category: data
relations:
  - type: supersedes
    target: ADR-0041
    why: the replicas change the storage decision
    link: ./0041-store-data-in-postgresql-itest-mvzo403u.md
---
## Context

Read load grew.

## Decision

Use PostgreSQL with read replicas; this replaces [ADR-0041][ADR-0041].

## Consequences

Replica lag is acceptable.

[ADR-0041]: ./0041-store-data-in-postgresql-itest-mvzo403u.md
