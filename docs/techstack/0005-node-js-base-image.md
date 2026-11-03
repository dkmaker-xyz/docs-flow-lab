---
id: TECH-0005
title: Node.js base image
description: Approved for the tech check test.
intent: Approved Node.js base image for the test apps.
when: Phase 7 integration test only.
state: accepted
category: ci
ecosystem: docker
packages:
  - name: node
    version: 24.*
rationale: "Test data: approved so the code test repository passes."
license: MIT
last_review: 2026-11-02
review_interval_months: 12
relations:
  - type: relates-to
    target: ADR-0057
    why: the service uses the approved Node.js base image
    link: ../adr/0057-search-runs-as-a-separate-service.md
---
Test data for the tech check.
