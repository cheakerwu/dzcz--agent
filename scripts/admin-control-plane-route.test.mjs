import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

test('admin control plane express route serves shared dispatcher actions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-admin-route-'));
  const previousDocker = process.env.DEEPBOT_DOCKER;
  const previousDbDir = process.env.DB_DIR;
  process.env.DEEPBOT_DOCKER = 'true';
  process.env.DB_DIR = dir;

  try {
    execFileSync('pnpm', ['run', 'build:web-server'], { cwd: root, stdio: 'inherit' });
    const express = require('express');
    const { createAdminControlPlaneRouter } = require('../dist-server/server/routes/admin-control-plane.js');

    const app = express();
    app.use(express.json());
    app.use('/api/admin-control-plane', createAdminControlPlaneRouter());

    const server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}/api/admin-control-plane`;
      const createResult = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'stores.create',
          payload: {
            actorId: 'route-test',
            input: {
              name: '路由测试店',
              brand: '点之出众',
              city: '上海',
              area: '徐汇',
              status: 'operating',
            },
          },
        }),
      }).then((response) => response.json());

      assert.equal(createResult.success, true);
      assert.equal(createResult.data.name, '路由测试店');

      const platformAccount = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'platformAccounts.create',
          payload: {
            actorId: 'route-test',
            input: {
              platform: 'meituan',
              label: '路由测试美团账号',
              storeId: createResult.data.id,
              riskAccountClass: 'high_risk',
            },
          },
        }),
      }).then((response) => response.json());
      assert.equal(platformAccount.success, true);
      assert.equal(platformAccount.data.riskAccountClass, 'high_risk');

      const loginRequest = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'browserLoginRequests.create',
          payload: {
            actorId: 'route-test',
            input: {
              connectorId: 'feishu',
              requesterUserId: 'ou_route',
              storeId: createResult.data.id,
              platform: 'meituan',
              platformAccountId: platformAccount.data.id,
              loginUrl: 'https://ecom.meituan.com/',
            },
          },
        }),
      }).then((response) => response.json());
      assert.equal(loginRequest.success, true);
      assert.equal(loginRequest.data.status, 'pending_confirmation');

      const importedProfile = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'browserProfiles.importFromBrowserAct',
          payload: {
            actorId: 'route-test',
            input: {
              platform: 'meituan',
              label: '路由测试 BrowserAct',
              storeId: createResult.data.id,
              browserActBrowserId: 'chrome_route_1',
              riskLevel: 'high',
              allowedActionLevel: 'high_risk_write',
            },
          },
        }),
      }).then((response) => response.json());
      assert.equal(importedProfile.success, true);
      assert.equal(importedProfile.data.storageStateRef, 'browser-act:chrome_route_1');

      const loginRequests = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'browserLoginRequests.list', payload: { filter: { requesterUserId: 'ou_route' } } }),
      }).then((response) => response.json());
      assert.equal(loginRequests.success, true);
      assert.equal(loginRequests.data.length, 1);

      const dashboard = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'dashboard.get' }),
      }).then((response) => response.json());

      assert.equal(dashboard.success, true);
      assert.equal(dashboard.data.counts.stores, 1);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve(undefined));
      });
    }
  } finally {
    if (previousDocker === undefined) {
      delete process.env.DEEPBOT_DOCKER;
    } else {
      process.env.DEEPBOT_DOCKER = previousDocker;
    }
    if (previousDbDir === undefined) {
      delete process.env.DB_DIR;
    } else {
      process.env.DB_DIR = previousDbDir;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
