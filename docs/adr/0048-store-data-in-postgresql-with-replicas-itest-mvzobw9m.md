---
id: ADR-0048
title: Store data in PostgreSQL with replicas itest-mvzobw9m
description: Adds read replicas.
intent: Where service data is stored, now with replicas.
when: When a change stores or reads data.
state: accepted
category: data
relations:
  - type: supersedes
    target: ADR-0047
    why: the replicas change the storage decision
    link: ./0047-store-data-in-postgresql-itest-mvzobw9m.md
---
## Context

Read load grew.

## Decision

Use PostgreSQL with read replicas; this replaces [ADR-0047][ADR-0047].

## Consequences

Replica lag is acceptable.

[ADR-0047]: ./0047-store-data-in-postgresql-itest-mvzobw9m.md
