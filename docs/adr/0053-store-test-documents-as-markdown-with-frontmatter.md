---
id: ADR-0053
title: Store test documents as markdown with frontmatter
description: Test documents are markdown with YAML frontmatter.
intent: Second test decision; supersedes ADR-0052 in the phase 5 test.
when: Phase 5 integration test only.
state: accepted
category: architecture
relations:
  - type: supersedes
    target: ADR-0052
    why: frontmatter changes how test documents are stored
    link: ./0052-store-test-documents-as-markdown.md
  - type: relates-to
    target: ADR-0054
    why: the decision this fix belongs to
    link: ./0054-clarify-the-frontmatter-decision.md
---
## Context

Test documents need structured metadata.

## Decision

Store test documents as markdown with YAML frontmatter; this replaces [ADR-0052][ADR-0052].

## Consequences

The CLI validates the frontmatter.

[ADR-0052]: ./0052-store-test-documents-as-markdown.md
