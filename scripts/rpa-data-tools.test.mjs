import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const { rpaDataImportToolPlugin } = require('../dist-electron/main/domains/tools/rpa-data-import-tool.js');
const { storeMetricsToolPlugin } = require('../dist-electron/main/domains/tools/store-metrics-tool.js');
const { storeReportToolPlugin } = require('../dist-electron/main/domains/tools/store-report-tool.js');
const { TOOL_NAMES } = require('../dist-electron/main/domains/tools/tool-names.js');

test('RPA data tools expose LLM-orchestrated controlled actions', async () => {
  const opts = { workspaceDir: process.cwd(), sessionId: 'test-session' };
  const importTools = await rpaDataImportToolPlugin.create(opts);
  const metricTools = await storeMetricsToolPlugin.create(opts);
  const reportTools = await storeReportToolPlugin.create(opts);
  const tools = [...importTools, ...metricTools, ...reportTools];

  assert.ok(tools.some((tool) => tool.name === TOOL_NAMES.RPA_DATA_IMPORT));
  assert.ok(tools.some((tool) => tool.name === TOOL_NAMES.STORE_METRICS));
  assert.ok(tools.some((tool) => tool.name === TOOL_NAMES.STORE_REPORT));
  assert.match(
    tools.find((tool) => tool.name === TOOL_NAMES.STORE_METRICS).description,
    /LLM/
  );
});
