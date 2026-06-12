# Domain Directory Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `src/main` by domain and infrastructure while preserving behavior and passing the project verification suite.

**Architecture:** Move main-process domain folders under `src/main/domains`, runtime/integration infrastructure under `src/main/infrastructure`, and Electron entry/preload files under `src/main/app`. Repair TypeScript imports mechanically, then use `tsc` and focused regression tests as the source of truth.

**Tech Stack:** TypeScript, Electron main process, Node.js migration script, pnpm, existing Node test scripts.

---

## File Structure

- Create `scripts/rewrite-main-imports.mjs`: mechanical import specifier repair for moved `src/main` files.
- Move `src/main/admin-control-plane` to `src/main/domains/admin-control-plane`.
- Move `src/main/agent-runtime` to `src/main/domains/agent-runtime`.
- Move `src/main/analytics` to `src/main/domains/analytics`.
- Move `src/main/browser-act` to `src/main/domains/browser-act`.
- Move `src/main/connectors` to `src/main/domains/connectors`.
- Move `src/main/prompts` to `src/main/domains/prompts`.
- Move `src/main/scheduled-tasks` to `src/main/domains/scheduled-tasks`.
- Move `src/main/session` to `src/main/domains/sessions`.
- Move `src/main/store-matcher` to `src/main/domains/stores`.
- Move `src/main/tools` to `src/main/domains/tools`.
- Move `src/main/config` to `src/main/infrastructure/config/constants`.
- Move `src/main/config/constants.ts` to `src/main/infrastructure/config/constants/app-constants.ts`.
- Move `src/main/config.ts` to `src/main/infrastructure/config/index.ts`.
- Move `src/main/context` to `src/main/infrastructure/context`.
- Move `src/main/database` to `src/main/infrastructure/database`.
- Move `src/main/ipc` to `src/main/infrastructure/ipc`.
- Move `src/main/utils` to `src/main/infrastructure/utils`.
- Move `src/main/browser` to `src/main/infrastructure/browser`.
- Move `src/main/gateway.ts`, `gateway-tab.ts`, `gateway-message.ts`, `gateway-connector.ts` to `src/main/infrastructure/gateway`.
- Move `src/main/index.ts` to `src/main/app/electron/index.ts`.
- Move `src/main/preload.ts` to `src/main/app/preload/preload.ts`.
- Modify `package.json`: `main` points to `dist-electron/main/app/electron/index.js`.
- Modify source imports affected by the moves.
- Modify scripts/tests that require moved `dist-electron/main/...` paths.

## Task 1: Baseline and Import Rewrite Tool

**Files:**
- Create: `scripts/rewrite-main-imports.mjs`

- [ ] **Step 1: Run baseline verification**

Run:

```bash
pnpm run type-check
pnpm run test:admin-memory
pnpm run test:remote-login
pnpm run test:rpa-data
git diff --check
```

Expected: all pass before the move starts.

- [ ] **Step 2: Create import rewrite script**

Create `scripts/rewrite-main-imports.mjs` that:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const mainRoot = resolve(root, 'src/main');
const sourceFiles = execFileSync('rg', ['--files', 'src/main', 'src/server', 'src/renderer', 'scripts'], {
  cwd: root,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

const movedRoots = [
  ['src/main/admin-control-plane', 'src/main/domains/admin-control-plane'],
  ['src/main/agent-runtime', 'src/main/domains/agent-runtime'],
  ['src/main/analytics', 'src/main/domains/analytics'],
  ['src/main/browser-act', 'src/main/domains/browser-act'],
  ['src/main/connectors', 'src/main/domains/connectors'],
  ['src/main/prompts', 'src/main/domains/prompts'],
  ['src/main/scheduled-tasks', 'src/main/domains/scheduled-tasks'],
  ['src/main/session', 'src/main/domains/sessions'],
  ['src/main/store-matcher', 'src/main/domains/stores'],
  ['src/main/tools', 'src/main/domains/tools'],
  ['src/main/config', 'src/main/infrastructure/config/constants'],
  ['src/main/context', 'src/main/infrastructure/context'],
  ['src/main/database', 'src/main/infrastructure/database'],
  ['src/main/ipc', 'src/main/infrastructure/ipc'],
  ['src/main/utils', 'src/main/infrastructure/utils'],
  ['src/main/browser', 'src/main/infrastructure/browser'],
];

const movedFiles = [
  ['src/main/config.ts', 'src/main/infrastructure/config/index.ts'],
  ['src/main/config/constants.ts', 'src/main/infrastructure/config/constants/app-constants.ts'],
  ['src/main/gateway.ts', 'src/main/infrastructure/gateway/gateway.ts'],
  ['src/main/gateway-tab.ts', 'src/main/infrastructure/gateway/gateway-tab.ts'],
  ['src/main/gateway-message.ts', 'src/main/infrastructure/gateway/gateway-message.ts'],
  ['src/main/gateway-connector.ts', 'src/main/infrastructure/gateway/gateway-connector.ts'],
  ['src/main/index.ts', 'src/main/app/electron/index.ts'],
  ['src/main/preload.ts', 'src/main/app/preload/preload.ts'],
];

function normalizePath(value) {
  return value.split(sep).join('/');
}

function applyMove(path) {
  const normalized = normalizePath(path);
  for (const [from, to] of movedFiles) {
    const base = from.replace(/\.ts$/, '');
    if (normalized === base || normalized === from) {
      return to.replace(/\.ts$/, '');
    }
  }
  for (const [from, to] of movedRoots) {
    if (normalized === from || normalized.startsWith(`${from}/`)) {
      return `${to}${normalized.slice(from.length)}`;
    }
  }
  return normalized;
}

function toSpecifier(fromFile, targetNoExt) {
  const fromDir = dirname(resolve(root, fromFile));
  const target = resolve(root, targetNoExt);
  let next = normalizePath(relative(fromDir, target));
  if (!next.startsWith('.')) next = `./${next}`;
  return next;
}

function rewriteSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const abs = resolve(dirname(resolve(root, fromFile)), specifier);
  const rel = normalizePath(relative(root, abs));
  if (!rel.startsWith('src/main/')) return specifier;
  const moved = applyMove(rel);
  if (moved === rel) return specifier;
  return toSpecifier(fromFile, moved);
}

for (const file of sourceFiles) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
  let content = readFileSync(file, 'utf8');
  const original = content;
  content = content.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, prefix, specifier, suffix) =>
    `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`);
  content = content.replace(/(require\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (_, prefix, specifier, suffix) =>
    `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`);
  content = content.replace(/(import\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (_, prefix, specifier, suffix) =>
    `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`);
  if (content !== original) {
    writeFileSync(file, content);
  }
}
```

- [ ] **Step 3: Run the script before moving**

Run:

```bash
node scripts/rewrite-main-imports.mjs
git diff -- scripts/rewrite-main-imports.mjs
```

Expected: only the new script exists; imports should not change before file moves.

## Task 2: Move Main Source Tree

**Files:**
- Move the folders and files listed in File Structure.
- Modify `package.json`.

- [ ] **Step 1: Create target folders**

Run:

```bash
mkdir -p src/main/domains src/main/infrastructure/gateway src/main/infrastructure/config src/main/app/electron src/main/app/preload
```

- [ ] **Step 2: Move folders**

Run:

```bash
git mv src/main/admin-control-plane src/main/domains/admin-control-plane
git mv src/main/agent-runtime src/main/domains/agent-runtime
git mv src/main/analytics src/main/domains/analytics
git mv src/main/browser-act src/main/domains/browser-act
git mv src/main/connectors src/main/domains/connectors
git mv src/main/prompts src/main/domains/prompts
git mv src/main/scheduled-tasks src/main/domains/scheduled-tasks
git mv src/main/session src/main/domains/sessions
git mv src/main/store-matcher src/main/domains/stores
git mv src/main/tools src/main/domains/tools
git mv src/main/config src/main/infrastructure/config/constants
git mv src/main/context src/main/infrastructure/context
git mv src/main/database src/main/infrastructure/database
git mv src/main/ipc src/main/infrastructure/ipc
git mv src/main/utils src/main/infrastructure/utils
git mv src/main/browser src/main/infrastructure/browser
```

- [ ] **Step 3: Move top-level files**

Run:

```bash
git mv src/main/gateway.ts src/main/infrastructure/gateway/gateway.ts
git mv src/main/gateway-tab.ts src/main/infrastructure/gateway/gateway-tab.ts
git mv src/main/gateway-message.ts src/main/infrastructure/gateway/gateway-message.ts
git mv src/main/gateway-connector.ts src/main/infrastructure/gateway/gateway-connector.ts
git mv src/main/config.ts src/main/infrastructure/config/index.ts
git mv src/main/index.ts src/main/app/electron/index.ts
git mv src/main/preload.ts src/main/app/preload/preload.ts
```

- [ ] **Step 4: Update Electron main path**

Change `package.json`:

```json
"main": "dist-electron/main/app/electron/index.js"
```

- [ ] **Step 5: Run import rewrite**

Run:

```bash
node scripts/rewrite-main-imports.mjs
```

Expected: source imports now point to the new folders.

## Task 3: Repair Compile Breaks

**Files:**
- Modify imports wherever `tsc` reports unresolved paths.
- Modify tests requiring moved `dist-electron/main/...` paths.

- [ ] **Step 1: Run main type check**

Run:

```bash
pnpm exec tsc -p tsconfig.main.json --noEmit
```

Expected: either PASS or a list of unresolved imports.

- [ ] **Step 2: Repair unresolved imports**

For each unresolved import, update the import to the new relative path. Common targets:

```text
src/main/infrastructure/config/index
src/main/infrastructure/gateway/gateway
src/main/infrastructure/database/system-config-store
src/main/domains/tools/...
src/main/domains/connectors/...
src/main/domains/admin-control-plane/...
src/main/domains/browser-act/...
```

- [ ] **Step 3: Repeat main type check until clean**

Run:

```bash
pnpm exec tsc -p tsconfig.main.json --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run full type check**

Run:

```bash
pnpm run type-check
```

Expected: PASS.

## Task 4: Update Runtime and Tests

**Files:**
- Modify `package.json`, scripts, tests, and any Electron preload references if needed.

- [ ] **Step 1: Update require paths in tests**

Search:

```bash
rg -n "dist-electron/main/(admin-control-plane|agent-runtime|analytics|browser-act|connectors|prompts|tools|database|gateway|ipc|utils|session|store-matcher)" scripts src
```

Update matches to:

```text
dist-electron/main/domains/...
dist-electron/main/infrastructure/...
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm run test:admin-memory
pnpm run test:remote-login
pnpm run test:rpa-data
```

Expected: PASS.

- [ ] **Step 3: Fix test path misses**

If tests fail because `require()` paths still point to old `dist-electron/main/...`, update those test paths and rerun the focused tests.

## Task 5: Cleanup and Completion Audit

**Files:**
- Remove temporary scripts only if no longer needed.
- Keep `scripts/rewrite-main-imports.mjs` if it is useful for reviewing this migration.

- [ ] **Step 1: Check old top-level source folders are gone**

Run:

```bash
rg --files src/main | rg '^src/main/(admin-control-plane|agent-runtime|analytics|browser-act|connectors|database|ipc|prompts|scheduled-tasks|session|store-matcher|tools|utils|browser)/'
```

Expected: no output.

- [ ] **Step 2: Inspect new top-level shape**

Run:

```bash
find src/main -maxdepth 2 -type d | sort
```

Expected: `src/main/app`, `src/main/domains`, and `src/main/infrastructure` are the primary folders.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm run type-check
pnpm run test:admin-memory
pnpm run test:remote-login
pnpm run test:rpa-data
git diff --check
```

Expected: all pass and `git diff --check` has no output.

- [ ] **Step 4: Review changed files**

Run:

```bash
git status --short --branch
git diff --stat
```

Expected: moved source files and path repairs are present; no accidental generated build output is tracked.
