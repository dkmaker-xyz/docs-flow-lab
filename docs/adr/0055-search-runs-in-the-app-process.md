---
id: ADR-0055
title: Search runs in the app process
description: The v0.2.0 search runs inside the app.
intent: "Test 4.2: work on v0.2.0 has base release/v0.2.0."
when: Phase 6 integration test only.
state: superseded
category: architecture
relations:
  - type: relates-to
    target: CODE:dkmaker-xyz/docs-flow-lab-app/search.txt
    why: the search code of the release line
    link: ../../code/dkmaker-xyz/docs-flow-lab-app/search.txt.md
  - type: superseded-by
    target: ADR-0057
    why: search moves to its own service in v0.3.0
    link: ./0057-search-runs-as-a-separate-service.md
---
## Context

Release v0.2.0 adds search to the app.

## Decision

Search runs in the app process; see [CODE:dkmaker-xyz/docs-flow-lab-app/search.txt][CODE:dkmaker-xyz/docs-flow-lab-app/search.txt].

## Consequences

No separate search service.

[CODE:dkmaker-xyz/docs-flow-lab-app/search.txt]: ../../code/dkmaker-xyz/docs-flow-lab-app/search.txt.md
