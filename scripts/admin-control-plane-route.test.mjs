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
