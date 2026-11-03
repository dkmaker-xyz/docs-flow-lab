---
id: TECH-0007
title: marked
description: Markdown-to-HTML renderer for the documentation site.
intent: Approved Markdown renderer for the idc365-decisions documentation site.
when: When rendering Markdown to HTML in the CLI.
state: accepted
category: library
ecosystem: npm
packages:
  - name: marked
    version: 18.*
rationale: Zero dependencies, MIT, maintained; the CLI renderer escapes raw HTML and filters link targets.
license: MIT
last_review: 2026-11-03
review_interval_months: 12
---
## Use

`marked` renders the Markdown bodies of the documentation to HTML for the documentation site (`idc365-decisions site build`, phase 11). Use it only through the CLI's renderer, which turns raw HTML in a body into text and keeps only http(s), mailto, fragment and relative link targets.

## Why this one

- Zero runtime dependencies (MIT), maintained, CommonMark and GFM tables.
- markdown-it needs six packages (argparse, entities, linkify-it, mdurl, punycode.js, uc.micro); micromark over twenty.
- Sanitizing is done by the renderer itself (no raw HTML at all), so no DOM-based sanitizer such as DOMPurify (which needs jsdom on Node) is needed.

## Version

Pin an exact 18.x version that has been out for at least the cooldown period; 18.1.2 (released 2026-10-26) at the time of approval.
