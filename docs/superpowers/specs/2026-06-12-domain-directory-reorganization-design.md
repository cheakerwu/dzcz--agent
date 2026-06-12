# Domain Directory Reorganization Design

## Goal

Reorganize the main-process source tree by domain so future work on login state, memory, RPA data, reports, connectors, and tools does not keep accumulating in broad top-level folders.

The first pass focuses on `src/main`. Renderer UI and server route layout stay in place unless a compile error requires a small import update.

## Current Problem

The current `src/main` tree mixes business domains, runtime infrastructure, and app entry files at the same level:

- `admin-control-plane`
- `agent-runtime`
- `analytics`
- `browser-act`
- `connectors`
- `database`
- `ipc`
- `prompts`
- `tools`
- `utils`
- gateway files directly under `src/main`
- app entry files directly under `src/main`

The worst pressure point is `src/main/tools`, where tool plugins, registry code, providers, handlers, JSON templates, and feature-specific tools all share one flat folder.

## Target Shape

```text
src/main/
  app/
    electron/
    preload/
  domains/
    admin-control-plane/
    agent-runtime/
    analytics/
    browser-act/
    connectors/
    prompts/
    scheduled-tasks/
    sessions/
    stores/
    tools/
  infrastructure/
    config/
    context/
    database/
    gateway/
    ipc/
    utils/
```

## First-Pass Moves

Move domain folders:

```text
src/main/admin-control-plane -> src/main/domains/admin-control-plane
src/main/agent-runtime       -> src/main/domains/agent-runtime
src/main/analytics           -> src/main/domains/analytics
src/main/browser-act         -> src/main/domains/browser-act
src/main/connectors          -> src/main/domains/connectors
src/main/prompts             -> src/main/domains/prompts
src/main/scheduled-tasks     -> src/main/domains/scheduled-tasks
src/main/session             -> src/main/domains/sessions
src/main/store-matcher       -> src/main/domains/stores
src/main/tools               -> src/main/domains/tools
```

Move infrastructure folders:

```text
src/main/config              -> src/main/infrastructure/config
src/main/config/constants.ts -> src/main/infrastructure/config/constants/app-constants.ts
src/main/context             -> src/main/infrastructure/context
src/main/database            -> src/main/infrastructure/database
src/main/ipc                 -> src/main/infrastructure/ipc
src/main/utils               -> src/main/infrastructure/utils
src/main/browser             -> src/main/infrastructure/browser
```

Move gateway/app files:

```text
src/main/gateway.ts          -> src/main/infrastructure/gateway/gateway.ts
src/main/gateway-tab.ts      -> src/main/infrastructure/gateway/gateway-tab.ts
src/main/gateway-message.ts  -> src/main/infrastructure/gateway/gateway-message.ts
src/main/gateway-connector.ts -> src/main/infrastructure/gateway/gateway-connector.ts
src/main/index.ts            -> src/main/app/electron/index.ts
src/main/preload.ts          -> src/main/app/preload/preload.ts
src/main/config.ts           -> src/main/infrastructure/config/index.ts
```

## Tools Layout

First pass moves the full `tools` folder to `domains/tools` without subdividing every plugin. This keeps import repair mechanical. A later pass can split plugins into subfolders once the domain boundary is stable.

Existing nested folders stay nested:

```text
src/main/domains/tools/
  registry/
  providers/
  handlers/
  skill-manager/
  mcp-adapter/
  email-tool/
  feishu-card-templates/
```

## Import Strategy

After moving files, imports are repaired mechanically:

- `../database` becomes paths under `../../infrastructure/database` or `../infrastructure/database`, depending on caller location.
- `../gateway` becomes `../../infrastructure/gateway/gateway` or the appropriate relative path.
- `../tools` becomes `../../domains/tools` or sibling paths inside `domains/tools`.
- `../connectors` becomes `../../domains/connectors`.
- `../admin-control-plane` becomes `../../domains/admin-control-plane`.
- `../../shared` and `../../types` imports remain valid if the file depth stays under `src/main/domains/<name>` or `src/main/infrastructure/<name>`.

Prefer automated TypeScript-aware or path-aware rewrites, then use `tsc` errors to catch missed imports.

## Compatibility Shims

Avoid long-lived shims. A temporary `src/main/index.ts` or `src/main/preload.ts` shim is acceptable only if packaging or Electron config cannot be updated safely in the same pass.

Preferred result:

- `package.json.main` points to `dist-electron/main/app/electron/index.js`.
- Electron preload references are updated to the new compiled preload path.
- No old `src/main/<domain>` folders remain except intentionally kept files.

## Non-Goals

- Do not rewrite renderer UI architecture in this pass.
- Do not split every tool plugin into feature folders in this pass.
- Do not change business behavior.
- Do not change database schema beyond paths/imports.
- Do not rename public tool names.

## Verification

The reorganization is complete only if:

- `pnpm run type-check` passes.
- `pnpm run test:admin-memory` passes.
- `pnpm run test:remote-login` passes.
- `pnpm run test:rpa-data` passes.
- `git diff --check` has no output.
- `rg --files src/main | rg '^src/main/(admin-control-plane|agent-runtime|analytics|browser-act|connectors|database|ipc|prompts|scheduled-tasks|session|store-matcher|tools|utils|browser)/'` returns no source files.
