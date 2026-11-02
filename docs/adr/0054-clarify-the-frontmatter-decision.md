---
id: ADR-0054
title: Clarify the frontmatter decision
description: A patch-level clarification for the test.
intent: "Test 4.4: a fix on v0.1.1 merged to main."
when: Phase 6 integration test only.
state: accepted
category: architecture
relations:
  - type: relates-to
    target: ADR-0053
    why: the decision this fix belongs to
    link: ./0053-store-test-documents-as-markdown-with-frontmatter.md
---
## Context

A wording error in the test decision.

## Decision

Keep markdown with frontmatter; see [ADR-0053][ADR-0053].

## Consequences

None.

[ADR-0053]: ./0053-store-test-documents-as-markdown-with-frontmatter.md
