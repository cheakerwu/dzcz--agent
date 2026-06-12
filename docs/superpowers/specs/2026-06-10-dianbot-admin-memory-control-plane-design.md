# DianBot Admin Memory Control Plane Design

Date: 2026-06-10
Status: Partially superseded by `docs/superpowers/specs/2026-06-12-policy-three-layer-memory-design.md`
Owner: DianBot / 点之出众 internal agent workspace
Supersedes: `docs/superpowers/plans/2026-06-10-cowagent-capability-adoption.md` Task 3 as originally written

Update on 2026-06-12: old Markdown memory is not retained as runtime fallback. It may only be used as an explicit migration source that creates reviewable structured memory candidates.

## Summary

DianBot should evolve the local Electron application from a chat-first workbench with settings into a real admin control plane for restaurant operations. The admin console will manage stores, Feishu conversations, employees, browser login state, memory governance, and audit trails in one place.

The memory system should not be managed as isolated text files. Business relationships are the source of truth:

- The company operates all stores.
- Feishu conversations are bound to the stores they operate.
- Employees are assigned to the stores they are responsible for.
- Browser login states are bound to store, platform, and permission boundaries.
- Memories are searchable projections of these governed business facts.

The first implementation should keep the current Electron/React shell and SQLite storage, expose API-shaped admin services, and remain compatible with later web or server deployment.

## Goals

- Turn the local Electron app into an admin console, not only a settings dialog.
- Provide fast management of store, group, employee, login state, and memory relationships.
- Make structured business assignments the authority, with approved structured memories synced to optional providers such as mem0.
- Support enterprise, employee, conversation, store, and task memory governance.
- Keep browser login state separate from memory and protect it as a controlled operational asset.
- Make personnel changes, group changes, and store responsibility changes easy to perform safely.
- Preserve auditability for memory edits, login state use, and AI operations.

## Non-Goals

- Do not build a cloud multi-tenant SaaS console in the first phase.
- Do not store passwords, cookies, tokens, verification codes, or secrets in memory.
- Do not make mem0 the only administrative source of truth.
- Do not let the model decide login-state permissions or enterprise memory approval.
- Do not replace existing Feishu, WeChat, WeCom, Smart KF, Gateway, AgentRuntime, or chat UI behavior.

## Product Direction

Use a staged control-plane model:

```text
Phase 1: Electron Admin Console
Phase 2: Same React views backed by Express APIs for web mode
Phase 3: Team control plane with centralized database and multi-admin workflow
```

The first phase should reuse the existing Electron renderer and main-process IPC patterns. New admin features should be written behind service boundaries so they can also be exposed through `src/server/routes/` later.

## Core Entities

```text
Company
  └── Store
        ├── PlatformAccount
        ├── BrowserProfile
        ├── StoreMemory
        └── OperationTask

FeishuConversation
  ├── ConversationStoreBinding
  ├── ConversationMemory
  └── ConversationPolicy

Employee
  ├── EmployeeStoreAssignment
  ├── EmployeeMemory
  ├── EmployeeRole
  └── ToolPermission

MemoryItem
  ├── MemorySource
  ├── MemoryEntityLink
  ├── MemoryReview
  ├── MemoryVersion
  └── ProviderSyncState
```

Structured assignments own operational truth. Memory text is generated, approved, searched, and injected from those assignments.

## Admin Console Modules

### 1. Operations Dashboard

The landing page should show what requires administrator attention:

- Stores, active Feishu conversations, employees, and enabled connectors.
- structured memory and optional mem0 sync health.
- Pending memory reviews.
- Browser profiles that are expired, unhealthy, or near re-authentication.
- Feishu conversations without store bindings.
- Employees with store assignments but missing Feishu pairing.
- Recent high-risk AI operations.

### 2. Store Directory

The store directory is the business root of the system. Each store record should include:

- Store name, brand, city, area, platform identifiers, and operating status.
- Bound Feishu conversations.
- Responsible employees and collaborators.
- Bound platform accounts and browser profiles.
- Linked SOPs, store facts, active campaigns, and operation tasks.
- Active memory count, stale memory count, and last memory update.

Administrators should be able to open a store and immediately see who operates it, where it is discussed, which login state is available, and which memories influence AI behavior.

### 3. Feishu Conversation Management

Each Feishu private chat or group should be treated as a business container:

- Connector ID, conversation ID, chat type, group name, and member summary.
- Bound stores.
- Default task categories such as campaign, pricing, reporting, customer service, or inspection.
- Conversation memory scope and default TTL.
- Available browser profiles through store/platform permissions.
- Recent memory writes and rejected memory candidates.

Group-level memory retrieval should be constrained by the conversation ID and the stores bound to that conversation.

### 4. Employee And Permission Management

The employee module should manage pairing, responsibilities, and permission changes:

- Feishu sender ID, display name, pairing status, and admin status.
- Assigned stores.
- Joined or relevant conversations.
- Available tools.
- Available browser profiles.
- Personal memory.
- Recent operations and audit events.

The module should provide guided flows:

- Onboard employee: approve Feishu pairing, assign role, assign stores, grant tools, seed personal memory.
- Transfer employee: move stores, update conversation bindings, update personal memory, revoke old access.
- Offboard employee: revoke pairing, revoke tools, archive personal memory, remove browser-profile access, write audit event.

### 5. Memory Governance Console

The memory console should govern memory items across providers. It should support filtering by:

- Scope: enterprise, employee, conversation, store, task.
- Store, employee, conversation, platform, and category.
- Status: candidate, pending_review, active, conflicted, expired, archived, rejected.
- Source: Feishu message, administrator edit, Deep Dream, import, browser operation result, structured assignment.
- Confidence, last used time, expiration, and provider sync state.

Each memory item detail should expose:

- Current text.
- Source message, file, task, or structured assignment.
- Linked stores, employees, conversations, and platform accounts.
- Version history.
- Injection history when available.
- Actions: approve, reject, edit, archive, restore, promote, demote, merge duplicate, mark conflict, resync provider, delete from provider.

mem0 should be treated as a searchable provider. Local SQLite should hold governance metadata and provider sync state.

### 6. Browser Login State Vault

Browser login state must be managed separately from memory. It is an operational asset, not knowledge.

Each browser profile should include:

- Platform: Meituan, Ele.me, Douyin, Xiaohongshu, or another merchant backend.
- Bound store or store group.
- Browser profile path or storage-state reference.
- Health status, last checked time, and last successful use.
- Allowed employees, conversations, tools, and action levels.
- Risk level and confirmation requirements.
- Locked, expired, revoked, or needs_reauth status.

Secrets, cookies, tokens, passwords, and verification codes must never be injected into prompts or written to memory. Tool execution should receive only an internal capability reference.

### 7. Audit And Change Log

Every high-impact change should create an audit event:

- Store assignment changed.
- Conversation-store binding changed.
- Employee permission changed.
- Enterprise memory approved, edited, rejected, archived, or deleted.
- Browser profile used, revoked, or marked unhealthy.
- AI performed or attempted a high-risk browser action.

Audit logs should be filterable by entity, actor, action, timestamp, and risk level.

## Data Model

Initial SQLite tables:

```text
stores
employees
feishu_conversations
store_assignments
conversation_store_bindings

platform_accounts
browser_profiles
browser_profile_permissions
browser_profile_health_checks

memory_items
memory_sources
memory_entity_links
memory_reviews
memory_versions
memory_provider_sync

operation_policies
audit_events
```

`memory_items` should contain:

```text
id
provider
provider_memory_id
scope
category
content
status
confidence
expires_at
created_by
approved_by
last_used_at
supersedes_id
created_at
updated_at
```

`memory_entity_links` should connect memory to stores, employees, conversations, platform accounts, browser profiles, or tasks.

## Memory Sync Model

The system should use two axes:

```text
Authority axis:
  Structured assignments and admin decisions in SQLite

Retrieval axis:
  mem0 active memory search
  reviewed structured memory in SQLite
  optional legacy Markdown import candidates
```

When an administrator changes a structured assignment:

1. Update the structured table.
2. Generate memory candidates that reflect the new relationship.
3. Apply policy for automatic approval or review.
4. Sync approved memory to mem0.
5. Mark superseded memories as archived or conflicted.
6. Write an audit event.

The model avoids asking administrators to manually edit scattered natural-language memories for routine business changes.

## Runtime Retrieval Flow

For a Feishu message:

1. Resolve `senderId` to employee.
2. Resolve `conversationId` to Feishu conversation.
3. Load stores bound to the conversation.
4. Load stores assigned to the employee.
5. Compute the allowed operating scope from policy.
6. Search enterprise, employee, conversation, and store memory independently.
7. Add browser-profile availability only as internal tool context, not prompt memory.
8. Build compact memory prompt sections.
9. Enforce high-risk action confirmation before browser operations.

## Browser Operation Policy

Browser actions should be categorized:

```text
read_only: inspect backend state, read reports, download visible data
low_risk_write: draft content, fill forms without submitting
medium_risk_write: save drafts, update non-critical content
high_risk_write: price changes, stock changes, campaign publish, order or account actions
destructive: delete, cancel, remove, refund, irreversible submission
```

High-risk and destructive actions require explicit confirmation from an authorized person or configured administrator policy.

## Permissions

Suggested roles:

```text
admin: full control-plane access
ops_lead: approve operational memory, manage store/group assignments
operator: use assigned store tools and view assigned memory
viewer: read-only access to permitted stores and memory
```

Enterprise memory requires admin or ops lead approval. Employee memory can be written by the employee or admin. Conversation memory can be written by participants within that conversation, subject to sensitivity and lifecycle policy.

## Implementation Phases

### Phase 1: Control-Plane Foundation

- Add admin console navigation separate from the existing settings dialog.
- Add store, employee, and Feishu conversation tables.
- Add store assignment and conversation-store binding.
- Add audit events.
- Keep current memory behavior working.

### Phase 2: Memory Governance

- Add `memory_items`, sources, links, reviews, versions, and provider sync tables.
- Build memory governance UI.
- Add mem0 sync state and legacy Markdown migration-source references.
- Support approve, reject, edit, archive, promote, demote, and resync.

### Phase 3: Browser Login State Vault

- Add browser profile registry.
- Bind browser profiles to stores, platforms, employees, conversations, and tools.
- Add health checks and status states.
- Prevent secrets from entering prompts or memory.

### Phase 4: Business Change Workflows

- Add employee onboarding, transfer, and offboarding flows.
- Add group-to-store bulk binding.
- Add store responsibility matrix views.
- Auto-generate memory candidates from structured changes.

### Phase 5: Knowledge And Operations Layer

- Add SOP and knowledge wiki management.
- Link SOPs to stores, platforms, tasks, and memory.
- Add operation-policy management for browser actions.
- Add dashboards for stale memory, stale login state, and high-risk operations.

## Testing Strategy

Unit tests:

- Store assignment updates generate correct memory candidates.
- Conversation-store binding constrains retrieval scope.
- Employee offboarding revokes permissions and archives personal memory.
- Memory promotion requires authorized role.
- Browser profile secrets are never included in prompt context.

Integration tests:

- Feishu group message retrieves only memories for bound stores and conversation.
- Employee with no store assignment cannot operate store browser profile.
- Admin-approved enterprise memory syncs to mem0 and becomes searchable.
- Archived memory is removed or excluded from provider retrieval.
- High-risk browser action requires confirmation.

Manual verification:

- Create stores, employees, and Feishu groups.
- Bind one group to two stores and one employee to one store.
- Confirm group memory retrieval is scoped to the group stores.
- Transfer a store to another employee and confirm memory candidates update.
- Register a browser profile and confirm it is available only to authorized scopes.
- Revoke an employee and confirm pairing, browser access, and memory access are removed.

## First Implementation Decisions

- Open the admin console as a full-screen in-app workspace view, with settings remaining available as a narrower configuration surface.
- Run browser profile health checks on demand in phase 1, then add scheduled checks after the Browser Login State Vault exists.
- Allow `admin` and `ops_lead` to approve operational enterprise memory, but reserve security, credential, and destructive-action policies for `admin`.
- Store assignments take effect immediately in phase 1. Effective date ranges can be added after transfer and offboarding flows are stable.
