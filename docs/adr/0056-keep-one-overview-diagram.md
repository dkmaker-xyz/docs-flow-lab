---
id: ADR-0056
title: Keep one overview diagram
description: One overview diagram describes the system.
intent: "Test 5.3: a document linking to ATT-0001."
when: Phase 8 integration test only.
state: accepted
category: architecture
relations:
  - type: attachment
    target: ATT-0001
    why: the diagram this decision describes
    link: ../attachment/0001-system-overview-diagram.md
  - type: relates-to
    target: ADR-0058
    why: keeps the overview diagram current
    link: ./0058-read-the-documentation-in-the-local-viewer.md
---
## Context

The system needs an overview.

## Decision

The overview diagram is the reference: [ATT-0001][ATT-0001].

## Consequences

Changes to the parts update the diagram.

[ATT-0001]: ../attachment/0001-system-overview-diagram.md
