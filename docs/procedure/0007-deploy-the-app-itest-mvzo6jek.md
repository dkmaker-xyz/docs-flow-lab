---
id: PROC-0007
title: Deploy the app itest-mvzo6jek
description: How the app is deployed.
intent: Steps to deploy.
when: When you deploy.
state: accepted
category: release
relations:
  - type: relates-to
    target: CODE:acme/app/scripts/deploy.sh
    why: the deploy script
    link: ../../code/acme/app/scripts/deploy.sh.md
---
## Trigger

A release is ready.

## Roles

Agent, release manager.

## Steps

1. (agent) Run [CODE:acme/app/scripts/deploy.sh][CODE:acme/app/scripts/deploy.sh].
2. (human) Approve the deployment.

## Done

The new version runs.

[CODE:acme/app/scripts/deploy.sh]: ../../code/acme/app/scripts/deploy.sh.md
