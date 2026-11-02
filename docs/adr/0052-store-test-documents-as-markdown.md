---
id: ADR-0052
title: Store test documents as markdown
description: Test documents are markdown files in the repository.
intent: First test decision; superseded in the phase 5 test.
when: Phase 5 integration test only.
state: superseded
category: architecture
relations:
  - type: superseded-by
    target: ADR-0053
    why: frontmatter changes how test documents are stored
    link: ./0053-store-test-documents-as-markdown-with-frontmatter.md
---
## Context

The test repository needs a first decision to supersede.

## Decision

Store test documents as markdown files in the repository.

## Consequences

Every change goes through a pull request.
