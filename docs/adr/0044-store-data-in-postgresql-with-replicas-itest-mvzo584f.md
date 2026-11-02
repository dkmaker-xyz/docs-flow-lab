---
id: ADR-0044
title: Store data in PostgreSQL with replicas itest-mvzo584f
description: Adds read replicas.
intent: Where service data is stored, now with replicas.
when: When a change stores or reads data.
state: accepted
category: data
relations:
  - type: supersedes
    target: ADR-0043
    why: the replicas change the storage decision
    link: ./0043-store-data-in-postgresql-itest-mvzo584f.md
---
## Context

Read load grew.

## Decision

Use PostgreSQL with read replicas; this replaces [ADR-0043][ADR-0043].

## Consequences

Replica lag is acceptable.

[ADR-0043]: ./0043-store-data-in-postgresql-itest-mvzo584f.md
