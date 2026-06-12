import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const { default: Database } = require('../dist-electron/shared/utils/sqlite-adapter.js');
const { AdminControlPlaneService } = require('../dist-electron/main/domains/admin-control-plane/service.js');
const { AnalyticsDatabase } = require('../dist-electron/main/domains/analytics/analytics-database.js');
const { RpaImportService } = require('../dist-electron/main/domains/analytics/rpa-import-service.js');
const { MetricService } = require('../dist-electron/main/domains/analytics/metric-service.js');
const { ReportService } = require('../dist-electron/main/domains/analytics/report-service.js');

test('imports sample RPA files, maps external store IDs, and computes daily metrics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-rpa-data-'));

  try {
    const sourceDir = join(dir, 'source');
    cpSync('/Users/dzcz/门店每日数据_副本', sourceDir, { recursive: true });

    const controlDb = new Database(join(dir, 'control.db'));
    const admin = new AdminControlPlaneService(controlDb);
    admin.ensureSchema();

    const store = admin.createStore({
      name: '趣东北·东北小馆(石岩店)',
      brand: '趣东北',
      city: '深圳',
      area: '石岩',
      aliases: ['趣东北', '东北小馆'],
      status: 'operating',
    }, 'test');

    admin.upsertExternalStoreMapping({
      storeId: store.id,
      platform: 'meituan',
      sourceApp: 'rpa_file',
      externalStoreId: '28743970',
      externalStoreName: '趣东北·东北小馆(石岩店)',
    }, 'test');
    admin.upsertExternalStoreMapping({
      storeId: store.id,
      platform: 'unknown',
      sourceApp: 'rpa_file',
      externalStoreId: '1294979950',
      externalStoreName: '趣东北·东北小馆(石岩店)',
    }, 'test');

    const analytics = await AnalyticsDatabase.open(join(dir, 'analytics.duckdb'));
    await analytics.ensureSchema();

    const importer = new RpaImportService({ admin, analytics });
    const first = await importer.importDirectory(sourceDir);
    assert.equal(first.success, true);
    assert.ok(first.importedFiles >= 4);
    assert.equal(first.unmatchedStores.length, 0);

    const second = await importer.importDirectory(sourceDir);
    assert.equal(second.skippedFiles, first.importedFiles);

    const metrics = new MetricService(analytics);
    const summary = await metrics.getDailySummary({
      storeIds: [store.id],
      startDate: '2026-06-08',
      endDate: '2026-06-08',
    });
    assert.equal(summary.storeIds[0], store.id);
    assert.ok(summary.orderCount > 0);
    assert.ok(summary.productCount > 0);

    const report = await new ReportService(metrics).generateDailyReport({
      storeIds: [store.id],
      businessDate: '2026-06-08',
    });
    assert.match(report.title, /每日经营日报/);
    assert.ok(report.sections.some((section) => section.key === 'overview'));

    await analytics.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
