# Business Task Policy Execution Design

Date: 2026-06-09
Branch: feature/business-pack-execution-agent
Status: Approved direction, pending user review of written spec

## Purpose

This design adds a business-pack layer that lets Local Agent Terminal use
`agent-browser` as a low-level browser execution engine while exposing safe,
business-oriented tools to the Agent.

The system must support both:

- read tasks: collect business data, normalize it, preserve evidence, and let
  the Agent analyze it.
- write tasks: modify business backend state through a constrained, auditable,
  confirmation-aware execution flow.

The design intentionally avoids fixed click-by-click recipes. A fixed recipe is
too brittle and weakens generalization when pages change. Instead, this design
uses a policy-bounded dynamic task executor: the Agent can plan within business
constraints, while tools enforce allowed actions, risk policy, dry-run behavior,
confirmation, evidence capture, and post-action verification.

## Current Context

The project already has the main integration points:

- `agent-browser` is present as a package dependency and its binaries are
  included in Electron packaging.
- `AgentBrowserWrapper` already wraps the CLI for browser actions.
- A generic browser tool already exposes low-level browser operations to the
  Agent.
- `ToolLoader` centralizes tool registration, making it the correct point to
  append business-pack tools.
- External routes can already send messages or commands to named Agent tabs.
- `BUSINESS_PACK_INTEGRATION_PLAN.md` already identifies that the first
  technical goal is a thin `business-packs` layer, not an Agent runtime refactor.

The missing layer is a first-class business-pack boundary that owns domain
tools, domain skills, schemas, task policies, account semantics, and risk rules.

## Goals

1. Add a minimal business-pack platform that can discover enabled packs and
   load pack-owned tools into the existing Agent runtime.
2. Create a `merchant-ops` example pack as the first business pack.
3. Use `agent-browser` behind domain tools, not as the direct business API
   exposed to the Agent.
4. Support generalized read tasks for data collection and analysis.
5. Support bounded write tasks for modifying backend state safely.
6. Preserve evidence for both read and write tasks.
7. Make all high-risk write actions dry-run by default and confirmation-gated.
8. Keep core Local Agent Terminal free of merchant-specific concepts.

## Non-Goals

1. Do not implement many real platform workflows in the first pass.
2. Do not hard-code merchant concepts into core Agent runtime files.
3. Do not replace the existing generic browser tool.
4. Do not let the Agent freely perform high-risk write operations through raw
   browser primitives.
5. Do not bypass platform authentication, anti-abuse systems, captchas, or
   manual verification requirements.

## Architecture

The runtime flow is:

```text
User or external system instruction
  -> Local Agent Terminal tab
  -> Agent + business Skill
  -> business-pack domain tool
  -> business task policy executor
  -> platform adapter
  -> agent-browser wrapper
  -> page state, downloads, screenshots, network data
  -> normalized data and evidence
  -> Agent analysis or execution result
```

The key design rule is:

```text
Core owns generic runtime mechanics.
Business packs own business meaning.
```

Core owns:

- sessions and tabs
- Agent runtime
- generic tools
- generic browser wrapper
- tool loading mechanics
- skill discovery mechanics
- scheduled task engine
- external API

Business packs own:

- domain tools
- domain Skills
- task policies
- domain schemas
- platform adapters
- account and store semantics
- domain risk levels
- evidence conventions
- analysis templates

## Business Pack Shape

The first pack should use this shape:

```text
business-packs/
  merchant-ops/
    manifest.json
    README.md
    prompts/
      system.md
    skills/
      merchant-daily-report/
        SKILL.md
      merchant-store-diagnosis/
        SKILL.md
      merchant-safe-execution/
        SKILL.md
    tools/
      merchant-task-tool.ts
      merchant-browser-adapter.ts
      merchant-analysis-tool.ts
    schemas/
      task-policy.schema.json
      collected-data.schema.json
      evidence.schema.json
      execution-result.schema.json
    examples/
      daily-report-command.md
      safe-execution-command.md
```

The manifest should declare tool entries, skills, permissions, schedules, and
pack-scoped config fields.

## Task Policy Model

A task policy is not a click script. It is a bounded execution contract.

Example write task policy:

```json
{
  "id": "store.contact.update",
  "displayName": "Update store contact phone",
  "mode": "write",
  "riskLevel": "high",
  "dryRunDefault": true,
  "confirmationRequired": true,
  "allowedActions": [
    "navigate",
    "search",
    "read_state",
    "click",
    "fill",
    "save",
    "screenshot"
  ],
  "preconditions": [
    "platform_logged_in",
    "store_selected",
    "phone_valid"
  ],
  "verification": {
    "type": "read_after_write",
    "expectation": "contact.phone equals params.phone"
  }
}
```

The policy defines what is allowed and how success is verified. It does not
need to define the exact sequence of selectors. The executor can use current
page snapshots, semantic element search, platform adapters, and Agent planning
to decide the concrete path.

## Read Tasks

Read tasks should be generalized and schema-driven.

Example tool call:

```ts
merchant_collect_data({
  platform: "meituan",
  storeAlias: "store-a",
  objective: "collect yesterday business metrics and diagnose anomalies",
  dateRange: "yesterday",
  expectedData: ["orders", "gmv", "conversion", "refunds", "reviews"],
  saveEvidence: true
})
```

Read task behavior:

1. Resolve platform and store alias from pack config.
2. Check login state.
3. Navigate or search dynamically.
4. Collect visible page text, screenshots, downloads, and network data when
   available.
5. Normalize collected data into a typed result.
6. Save evidence paths.
7. Return structured JSON to the Agent for analysis.

Read tasks are allowed more dynamic exploration because they do not mutate
business state.

## Write Tasks

Write tasks should be goal-driven but bounded by policy.

Example tool call:

```ts
merchant_execute_task({
  platform: "meituan",
  storeAlias: "store-a",
  taskId: "store.contact.update",
  params: {
    phone: "13800000000"
  },
  dryRun: true
})
```

Write task behavior:

1. Resolve task policy.
2. Validate params against the task schema.
3. Check login state and store selection.
4. Capture before-state evidence.
5. Build an execution plan from current page state.
6. If `dryRun` is true, return the plan and evidence without mutating state.
7. If mutation is requested, require confirmation when policy demands it.
8. Execute only allowed action types.
9. Capture after-state evidence.
10. Run verification.
11. Return a typed execution result.

Write tasks must stop instead of guessing when:

- login state is missing
- platform or store cannot be resolved
- confirmation is missing
- page state does not match preconditions
- the executor cannot identify the target field or action
- verification fails

## Domain Tools

The first pack should expose a small tool surface:

```ts
merchant_collect_data(args)
merchant_execute_task(args)
merchant_get_task_status(args)
```

Optional later tools:

```ts
merchant_list_platforms(args)
merchant_list_stores(args)
merchant_analyze_data(args)
merchant_seed_schedules(args)
```

The initial tool surface should stay small so the Agent gets clear affordances.
Detailed analysis can initially live in Skills and prompts, using structured
data returned by `merchant_collect_data`.

## Platform Adapters

Platform adapters isolate platform-specific behavior from task policy.

Adapter responsibilities:

- login-state detection
- store selection
- navigation hints
- semantic element hints
- data extraction hints
- platform-specific verification
- fallback paths for common page variants

The executor should depend on a platform adapter interface, not on platform
branches spread through tool code.

## Agent Browser Integration

`agent-browser` should remain a low-level execution engine.

The wrapper should be extended over time to support:

- safer command execution with argument arrays or JSON batch input
- batch execution for multi-step flows
- network request listing and HAR capture
- downloads
- profile, session, and state handling
- allowed domains
- action policy and confirmation support
- screenshot and evidence directory configuration

Business tools should not expose raw browser primitives to the Agent for
high-risk tasks. Raw browser primitives can remain available as generic tools
for exploration and troubleshooting.

## Evidence Model

Every business task should return an evidence object:

```ts
{
  evidenceId: string;
  createdAt: string;
  platform: string;
  storeAlias: string;
  taskId?: string;
  screenshots: string[];
  downloads: string[];
  rawTextPaths: string[];
  networkArtifacts: string[];
  beforeState?: unknown;
  afterState?: unknown;
}
```

Evidence should be stored under a pack-scoped evidence directory so reports and
debugging sessions can reference it later.

## Risk Policy

Risk levels:

- `low`: read-only or harmless local analysis.
- `medium`: changes with limited business impact.
- `high`: changes visible to customers, account settings, pricing, contact
  info, availability, payments, or platform compliance.

Rules:

1. Read tasks can run without confirmation.
2. Write tasks default to dry-run.
3. High-risk tasks require explicit confirmation.
4. Confirmation must be tied to a specific generated plan.
5. A confirmed plan expires after a short time or after page state changes.
6. Verification failure returns an error result and does not attempt unrelated
   recovery actions.

## Error Handling

All domain tools should return structured errors with these fields:

```ts
{
  success: false;
  errorCode: string;
  message: string;
  stage: string;
  recoverable: boolean;
  evidenceId?: string;
}
```

Important error codes:

- `LOGIN_REQUIRED`
- `STORE_NOT_FOUND`
- `POLICY_NOT_FOUND`
- `PARAM_VALIDATION_FAILED`
- `PRECONDITION_FAILED`
- `CONFIRMATION_REQUIRED`
- `CONFIRMATION_EXPIRED`
- `ELEMENT_NOT_FOUND`
- `PAGE_STATE_UNEXPECTED`
- `DOWNLOAD_FAILED`
- `NORMALIZATION_FAILED`
- `VERIFICATION_FAILED`

## Testing Strategy

Initial tests should focus on framework behavior, not real platform automation.

Verification should include:

1. Type checking for new business-pack files.
2. Manifest discovery with a fixture pack.
3. Pack tool loading into the existing ToolLoader flow.
4. Task policy validation.
5. Mocked read task execution.
6. Mocked write task dry-run execution.
7. Mocked write task confirmation requirement.
8. Mocked write task verification failure.
9. Evidence object creation and path shape.

Real platform flows should be added later as opt-in smoke tests because they
depend on credentials, live UI state, network conditions, and platform policies.

## Rollout Plan

Phase 1 creates the generic business-pack infrastructure and verifies that pack
tools can be loaded by the existing Agent runtime.

Phase 2 creates the `merchant-ops` example pack with read-task support and one
analysis Skill.

Phase 3 adds the policy-bounded write-task executor with dry-run, confirmation,
evidence, and verification.

Phase 4 extends `AgentBrowserWrapper` with batch, network, download, session,
and action-policy capabilities needed by business tools.

Phase 5 adds one minimal real platform adapter or a local mock platform page as
an executable template.

## Acceptance Criteria

The design is ready for implementation when:

1. A business pack can be discovered from configured pack directories.
2. Pack tools can be loaded without editing core tool names for each pack.
3. The Agent can call a pack-owned read tool.
4. The Agent can call a pack-owned write tool in dry-run mode.
5. A high-risk write task cannot mutate state without confirmation.
6. Read and write tasks return structured evidence.
7. The implementation does not add merchant-specific logic to core runtime.
8. Type checking passes.

## Design Decisions

1. Use task policies instead of fixed recipes.
2. Keep `agent-browser` behind domain tools for business operations.
3. Allow read tasks to be more dynamic than write tasks.
4. Require policy, dry-run, confirmation, evidence, and verification for write
   tasks.
5. Keep the first pack small and use it to prove the extension boundary.

