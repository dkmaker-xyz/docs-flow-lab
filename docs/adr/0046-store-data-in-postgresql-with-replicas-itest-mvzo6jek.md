---
id: ADR-0046
title: Store data in PostgreSQL with replicas itest-mvzo6jek
description: Adds read replicas.
intent: Where service data is stored, now with replicas.
when: When a change stores or reads data.
state: accepted
category: data
relations:
  - type: supersedes
    target: ADR-0045
    why: the replicas change the storage decision
    link: ./0045-store-data-in-postgresql-itest-mvzo6jek.md
---
## Context

Read load grew.

## Decision

Use PostgreSQL with read replicas; this replaces [ADR-0045][ADR-0045].

## Consequences

Replica lag is acceptable.

[ADR-0045]: ./0045-store-data-in-postgresql-itest-mvzo6jek.md
