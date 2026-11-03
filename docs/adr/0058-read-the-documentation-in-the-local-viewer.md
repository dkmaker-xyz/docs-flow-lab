---
id: ADR-0058
title: Read the documentation in the local viewer
description: Developers read the documentation with the local viewer.
intent: How developers read the documentation; test of two quick merges.
when: Phase 11 integration test only.
state: accepted
category: architecture
relations:
  - type: relates-to
    target: ADR-0056
    why: keeps the overview diagram current
    link: ./0056-keep-one-overview-diagram.md
---
## Context

The overview diagram ([ADR-0056][ADR-0056]) is read most often in the browser.

## Decision

Developers read the documentation with `idc365-decisions view`.

## Consequences

No hosted site is needed.

[ADR-0056]: ./0056-keep-one-overview-diagram.md
