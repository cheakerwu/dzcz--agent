# Feishu Layered Memory With mem0 Design

Date: 2026-06-10
Status: Superseded by `docs/superpowers/specs/2026-06-12-policy-three-layer-memory-design.md`
Owner: 点之出众 internal agent workspace

Update on 2026-06-12: old Markdown memory is no longer a runtime fallback. It may only be used as an explicit admin-triggered migration source that creates structured `pending_review` memory candidates.

## Summary

点之出众 will add a Feishu-aware three-layer memory system backed by mem0. The system will keep the existing local session history for audit and UI replay, but long-term reusable memory will be stored and retrieved through a new memory gateway that understands Feishu identity, enterprise permissions, conversation scope, and memory lifecycle rules.

The three memory layers are:

- Enterprise public memory: company policies, business process rules, merchant backend SOPs, approval rules, shared operating knowledge.
- Employee personal memory: per-employee responsibility scope, work preferences, permission boundaries, common workflows.
- Conversation or group memory: per-private-chat or per-group context such as active store, campaign, task, owner, and recent decision state.

The first implementation should use mem0 as the memory engine and keep 点之出众 responsible for permission checks, Feishu identity mapping, retrieval budgeting, prompt composition, and audit behavior.

## Goals

- Make Feishu the primary conversational memory boundary for internal enterprise use.
- Support three independent but composable memory layers: enterprise, employee, conversation.
- Prevent memory growth from degrading answer quality as Feishu message volume increases.
- Enforce the confirmed permission model:
  - Enterprise public memory can be written only by admins or explicit admin-approved actions.
  - Employees can write their own personal memory.
  - Conversation and group memory can be written automatically for task context, with lifecycle controls.
- Use mem0 for extraction, deduplication, semantic retrieval, entity-aware lookup, and memory scoring where available.
- Exclude old Markdown memory from runtime prompts; only allow explicit reviewed migration into structured memory.
- Preserve local session history separately from long-term memory.

## Non-Goals

- Do not replace the existing session JSONL history store. Session history remains the source for UI replay and audit.
- Do not build a full memory management UI in the first implementation.
- Do not store passwords, tokens, verification codes, bank information, personal identity documents, or full sensitive customer records in long-term memory.
- Do not let mem0 decide enterprise authorization policy. Authorization remains in 点之出众.
- Do not inject all memories into every request. Retrieval must be scoped and budgeted.

## Existing Project Context

The current codebase already has useful integration points:

- `src/main/tools/memory-tool.ts` manages Markdown memory files and exposes the `memory` tool.
- Before the 2026-06-12 policy/memory-gateway change, `src/main/prompts/system-prompt.ts` called `getMemoryContent(sessionId)` and injected one memory block into the system prompt.
- `src/main/gateway-connector.ts` receives connector messages, maps them to connector tabs, and has access to `connectorId`, `conversationId`, `senderId`, `senderName`, and `chatType`.
- `src/main/connectors/connector-manager.ts` converts connector-specific messages into `GatewayMessage`.
- `src/types/connector.ts` defines `GatewayMessage.source` with Feishu-compatible identity and conversation fields.
- `src/main/database/tab-config.ts` persists connector tabs, including `connectorId`, `conversationId`, and `memoryFile`.
- Existing Feishu connector tabs are keyed by `conversationKey = connectorId + "_" + conversationId`.

The current model is effectively:

```text
message -> connector tab -> sessionId -> one memory file -> prompt
```

The target model is:

```text
message -> Feishu identity context -> layered memory retrieval -> prompt
       -> post-response memory ingestion -> scoped memory writes
```

## mem0 Capabilities Used

The design relies on these mem0 concepts:

- `add`: extract stable memories from messages with `infer=true`.
- `search`: retrieve relevant memories with filters, top-k limits, thresholds, and optional reranking.
- Entity-scoped memory: use stable entity identifiers for user, agent, app, and run scopes.
- Group chat support: attribute messages to participants when message names are provided.
- Custom categories: classify enterprise and operations memory into business-specific categories.
- Memory decay or equivalent local scoring: lower priority for stale memories without immediate deletion.

References:

- https://github.com/mem0ai/mem0
- https://docs.mem0.ai/core-concepts/memory-operations/add
- https://docs.mem0.ai/core-concepts/memory-operations/search
- https://docs.mem0.ai/platform/features/entity-scoped-memory
- https://docs.mem0.ai/platform/features/group-chat
- https://docs.mem0.ai/platform/features/custom-categories
- https://docs.mem0.ai/platform/features/memory-decay
- https://docs.mem0.ai/cookbooks/essentials/controlling-memory-ingestion

## Architecture

Create a new memory subsystem under `src/main/memory/`.

```text
src/main/memory/
  memory-context.ts
  memory-provider.ts
  mem0-provider.ts
  markdown-memory-provider.ts
  layered-memory-service.ts
  memory-policy.ts
  memory-categories.ts
  memory-prompt.ts
```

### Component Responsibilities

`memory-context.ts`

- Defines `FeishuMemoryContext`.
- Converts connector message metadata into stable memory keys.
- Does not call mem0 or read files.

`memory-provider.ts`

- Defines provider interfaces for search, add, delete, and update.
- Lets the app support structured SQLite memory and optional mem0 search behind one boundary.

`mem0-provider.ts`

- Wraps mem0 SDK or HTTP API calls.
- Applies app-level defaults such as `app_id = "dzcz-feishu"`.
- Does not enforce enterprise business permissions.

`markdown-memory-provider.ts`

- Superseded by the 2026-06-12 runtime decision.
- Existing `memory.md` and tab memory files may only be read by an explicit migration importer.

`layered-memory-service.ts`

- Orchestrates enterprise, employee, and conversation memory retrieval.
- Applies token budgets and ranking.
- Builds the final memory context injected into prompts.
- Dispatches scoped writes after policy checks.

`memory-policy.ts`

- Decides whether a memory candidate can be written.
- Enforces admin-only enterprise memory writes.
- Filters sensitive content.
- Assigns status, category, expiration, and review behavior.

`memory-categories.ts`

- Defines business categories used with mem0 metadata and custom categories.

`memory-prompt.ts`

- Builds compact prompt sections:
  - Enterprise public memory
  - Employee personal memory
  - Conversation or group memory

## Memory Context

The memory subsystem must receive a context object derived from Feishu messages.

```ts
export interface FeishuMemoryContext {
  source: 'feishu';
  connectorId: 'feishu';
  senderId: string;
  senderName: string;
  conversationId: string;
  chatType: 'p2p' | 'group';
  groupName?: string;
  isAdmin: boolean;
  messageId?: string;
  timestamp: number;
}
```

Stable keys:

```ts
const appId = 'dzcz-feishu';
const enterpriseAgentId = 'dzcz-enterprise';
const employeeUserId = `feishu:${senderId}`;
const conversationRunId = `feishu:${conversationId}`;
```

Use Feishu stable identifiers for memory ownership. Display names must remain metadata only because they can change and can collide.

## mem0 Scope Mapping

Enterprise public memory:

```json
{
  "agent_id": "dzcz-enterprise",
  "app_id": "dzcz-feishu",
  "metadata": {
    "scope": "enterprise"
  }
}
```

Employee personal memory:

```json
{
  "user_id": "feishu:{senderId}",
  "app_id": "dzcz-feishu",
  "metadata": {
    "scope": "employee",
    "sender_name": "{senderName}"
  }
}
```

Conversation or group memory:

```json
{
  "run_id": "feishu:{conversationId}",
  "app_id": "dzcz-feishu",
  "metadata": {
    "scope": "conversation",
    "chat_type": "p2p | group",
    "group_name": "{groupName}"
  }
}
```

Do not rely on a single combined mem0 query for all layers. Each layer should be searched independently, then merged by 点之出众. This avoids accidental empty results from over-constrained entity filters and keeps ranking explainable.

## Retrieval Flow

For every Feishu message sent to the agent:

1. Build `FeishuMemoryContext` from `GatewayMessage.source`.
2. Derive the search query from the raw user message plus normalized source labels.
3. Search enterprise memory with `agent_id = dzcz-enterprise`.
4. Search employee memory with `user_id = feishu:{senderId}`.
5. Search conversation memory with `run_id = feishu:{conversationId}`.
6. Merge results with layer-specific budgets.
7. Inject compact, source-labeled memory sections into the prompt.

Default retrieval budgets:

```text
Enterprise public memory: 5 items
Employee personal memory: 5 items
Conversation or group memory: 8 items
```

Default priority:

```text
Conversation or group memory > Employee personal memory > Enterprise public memory
```

Enterprise public memory still acts as the safety and policy baseline. If lower-layer memory conflicts with enterprise memory, the prompt must tell the model to follow enterprise memory.

Prompt section format:

```text
## Layered Memory

### Enterprise Public Memory
- [merchant_sop] 美团后台价格修改必须经过运营负责人确认。

### Employee Personal Memory
- [employee_scope] 当前发送者常负责人民广场店和南京东路店。

### Conversation Or Group Memory
- [conversation_task] 当前群最近在处理人民广场店 618 套餐活动。

Memory priority: follow enterprise policy when lower-level memory conflicts with enterprise memory.
```

## Write Flow

Memory writes happen after the agent response path has accepted the user message. Writes should be asynchronous so the Feishu reply is not blocked by memory extraction.

1. Build a memory write request from:
   - Raw user message
   - Agent response summary
   - Feishu memory context
   - Current task state when available
2. Run `memory-policy.ts`.
3. Route allowed writes to the proper scope.
4. Use mem0 `add` with `infer=true` for stable extracted facts.
5. Store metadata for category, source, status, confidence, expiration, and Feishu identifiers.
6. Invalidate affected system prompt caches.

Explicit write examples:

```text
记到企业公共记忆：美团后台价格修改必须由运营负责人确认。
记住我负责人民广场店和南京东路店。
这个群记一下：本周重点处理 618 套餐活动。
```

Implicit write examples:

```text
Conversation memory:
- 群聊连续围绕同一门店、活动或任务展开。
- 明确出现负责人、截止时间、下一步动作。

Employee memory:
- 员工反复确认自己的负责门店、偏好或工作方式。

Enterprise memory:
- No implicit write. Enterprise writes require admin confirmation.
```

## Permission Model

Enterprise public memory:

- Admin explicit writes are active immediately.
- Non-admin enterprise write attempts become rejected or pending, depending on configuration.
- First implementation should reject non-admin enterprise writes with a clear response.

Employee personal memory:

- A user can write their own employee memory.
- A user cannot write another employee's personal memory unless they are an admin.
- Admins can correct employee memory when operationally necessary.

Conversation or group memory:

- Any participant in a Feishu conversation can contribute conversation memory.
- Conversation memory can be automatically inferred from task-like dialogue.
- Conversation memory gets an expiration policy by default.

Read access:

- Enterprise memory is readable by all Feishu users who are authorized to use the bot.
- Employee memory is readable only when the current sender matches the employee key, except admins in future management UI.
- Conversation memory is readable only within that conversation context.

## Memory Categories

Use these categories as mem0 metadata and custom category names where supported:

```text
enterprise_policy
merchant_sop
approval_rule
store_profile
employee_scope
employee_preference
permission_boundary
conversation_task
campaign_context
operation_report
risk_warning
tool_usage_preference
```

Category routing:

```text
enterprise_policy, merchant_sop, approval_rule -> enterprise
employee_scope, employee_preference, permission_boundary -> employee
conversation_task, campaign_context -> conversation
store_profile -> enterprise when confirmed, conversation when temporary
operation_report -> enterprise when it defines a template, conversation when task-specific
risk_warning -> enterprise for shared risks, conversation for local warnings
tool_usage_preference -> employee
```

## Sensitive Data Policy

The policy layer must reject or redact these before calling mem0:

- API keys, GitHub tokens, Feishu app secrets, model API keys.
- Passwords, verification codes, one-time links.
- Bank cards, personal identity documents, full phone numbers.
- Full customer addresses or unnecessary personal customer data.
- Credentials for merchant backends.

Allowed sensitive-adjacent data:

- Store names.
- Platform names.
- Role names and permission boundaries.
- Non-secret business process rules.
- Public or internal SOP text that does not include credentials.

When sensitive content is detected, the assistant may remember a safe abstraction:

```text
Do remember: 人民广场店的美团后台登录需要按公司凭据流程申请。
Do not remember: actual username, password, token, or verification code.
```

## Memory Growth Controls

The system must prevent memory bloat through retrieval limits, lifecycle policy, and periodic cleanup.

Conversation memory default lifecycle:

```text
conversation_task: 14 days since last use
campaign_context: campaign end date plus 7 days when known, otherwise 30 days
risk_warning: 30 days unless promoted
store_profile: 30 days unless promoted to enterprise memory
```

Employee memory lifecycle:

```text
employee_scope: no automatic deletion, lower rank after 90 days unused
employee_preference: lower rank after 90 days unused
permission_boundary: no automatic deletion, requires explicit update
tool_usage_preference: lower rank after 90 days unused
```

Enterprise memory lifecycle:

```text
enterprise_policy: no automatic deletion
merchant_sop: no automatic deletion
approval_rule: no automatic deletion
operation_report template: no automatic deletion
```

Promotion rule:

- Conversation memory can be promoted to enterprise memory only by an admin.
- Employee memory can be promoted to enterprise memory only if it is a shared process rule, not a personal preference.

Retrieval scoring should prefer relevant, recent, high-confidence, frequently used memories. If mem0 Platform memory decay is unavailable in the selected deployment mode, 点之出众 should implement a local decay multiplier using metadata timestamps.

## mem0 Add Instructions

When adding memories, pass instructions that match the enterprise context:

```text
Store only stable facts useful for internal business operations.

Allowed:
- company rules and approval requirements
- merchant backend SOPs
- employee responsibility scope and work preferences
- group task context, store, campaign, owner, deadline, next action

Rejected:
- casual chatter
- unconfirmed guesses
- secrets, passwords, tokens, verification codes
- personal customer identity data
- one-time links
- enterprise policy changes from non-admin users

Prefer concise memories.
Update or deduplicate conflicting facts.
Preserve Feishu source metadata.
```

## Configuration

Add configuration keys through the existing system config mechanism:

```text
memory_provider = "markdown" | "mem0"
mem0_mode = "platform" | "self_hosted"
mem0_api_key = encrypted or stored using existing secret-handling path
mem0_base_url = optional for self-hosted deployments
mem0_app_id = "dzcz-feishu"
memory_auto_write_enabled = true
memory_enterprise_requires_admin = true
memory_conversation_ttl_days = 14
```

For the first implementation, default to:

```text
memory_provider = "markdown"
memory_auto_write_enabled = false
memory_enterprise_requires_admin = true
```

This keeps current behavior stable until mem0 is configured.

## Error Handling

mem0 unavailable:

- Continue answering with current session context and structured SQLite memory if available.
- Log the provider error.
- Do not block Feishu replies.

Search failure:

- Omit layered memory for that request.
- Add a concise warning to logs, not to the user unless the user explicitly asked about memory.

Write failure:

- Do not retry synchronously in the Feishu request path.
- Queue one retry when a local queue exists.
- Surface repeated failures in admin logs.

Permission denial:

- For enterprise writes by non-admins, reply with a short message explaining that enterprise public memory requires administrator approval.

Sensitive data detection:

- Reject or redact the memory write.
- Do not call mem0 with known secret values.

## Prompt Integration

Replace the single `getMemoryContent(sessionId)` injection path with layered memory retrieval when a connector context is available.

Runtime behavior:

- UI/default tabs must not inject old Markdown as runtime memory.
- Non-Feishu connectors can omit structured memory until their connector context is mapped.
- Feishu connector tabs use structured three-layer memory from SQLite; mem0 is optional search infrastructure.

Prompt cache impact:

- Current code avoids injecting dynamic runtime data into the static system prompt for cache reasons.
- Layered memory is dynamic and should be injected through the existing per-call dynamic prompt or context path where possible.
- If the first implementation must use `buildSystemPrompt`, invalidate only the affected session prompt after memory writes.

## Migration

First migration behavior:

1. Do not keep `memory.md` as runtime fallback.
2. Optionally import selected `memory.md` content into `pending_review` structured memory candidates.
3. Do not automatically split old Markdown memory into employee or conversation memories.
4. New Feishu messages use structured layered memory after control-plane binding is available.

Tab memory files:

- Existing tab-specific Markdown memories remain readable.
- Feishu layered memory does not depend on tab-specific Markdown memory files and must not inject them at runtime.
- Future implementation may offer a one-time import for important connector tab memories.

## Observability

Add structured logs for:

- Layered memory search start and finish.
- Number of retrieved items per layer.
- Memory write candidates and final action.
- Permission denials.
- Sensitive data rejections.
- mem0 provider errors.
- Prompt injection token budget.

Do not log raw secrets or full sensitive content.

Future admin UI should show:

- Memory item scope.
- Category.
- Owner key.
- Source conversation.
- Last used time.
- Status.
- Whether the memory was injected into a response.

## Testing Strategy

Unit tests:

- `memory-context` builds stable keys from Feishu sender and conversation data.
- `memory-policy` allows admin enterprise writes and rejects non-admin enterprise writes.
- `memory-policy` allows employee self-writes and rejects cross-user writes by non-admins.
- `memory-policy` applies conversation TTL metadata.
- Sensitive data detection rejects tokens and passwords.
- `layered-memory-service` performs three independent searches and merges results in the correct order.

Integration tests:

- Feishu private message retrieves enterprise and employee memory.
- Feishu group message retrieves enterprise, employee, and conversation memory.
- mem0 search failure does not block message handling.
- mem0 write failure does not block Feishu reply.
- Enterprise memory write from non-admin returns a permission message.

Manual verification:

- Configure mem0 provider.
- Send a Feishu private message from a paired employee.
- Confirm employee memory is retrieved only for that employee.
- Send a group message.
- Confirm group memory is retrieved only for that conversation.
- Try non-admin enterprise memory write.
- Confirm it is rejected.
- Try admin enterprise memory write.
- Confirm it is stored and retrieved for another user.

## Implementation Phases

Phase 1: Provider boundary and context plumbing

- Add `src/main/memory/` interfaces and Feishu memory context.
- Keep old Markdown only as an explicit migration source.
- Add mem0 provider configuration.
- Do not change UI behavior.

Phase 2: Layered retrieval

- Implement enterprise, employee, and conversation searches.
- Inject layered memory into Feishu request context.
- Add retrieval limits and source-labeled prompt sections.
- Keep non-Feishu behavior unchanged.

Phase 3: Scoped writes and permissions

- Extend the memory tool or add a memory service entrypoint with scope-aware writes.
- Enforce admin-only enterprise writes.
- Add employee and conversation write support.
- Add sensitive data filtering.

Phase 4: Lifecycle and operations

- Add TTL metadata and local structured-memory decay behavior.
- Add memory write logs.
- Add promotion behavior from conversation memory to enterprise memory.

Phase 5: Admin management UI

- Show enterprise, employee, and conversation memories.
- Support approve, archive, delete, and promote actions.
- Show memory hit logs for explainability.

## Acceptance Criteria

- Feishu messages can retrieve all three memory layers without loading unrelated memories.
- Enterprise memory can be written only by admins.
- Employee memory is keyed by stable Feishu sender ID, not display name.
- Conversation memory is keyed by stable Feishu conversation ID.
- Conversation memory has a default lifecycle.
- mem0 provider failures do not block replies.
- Sensitive values are not sent to mem0 by the memory write path.
- Structured SQLite memory continues to work when mem0 is disabled.
- Non-Feishu connectors are not broken by the new memory subsystem.
- Tests cover policy, context mapping, layered retrieval, and provider failure behavior.
