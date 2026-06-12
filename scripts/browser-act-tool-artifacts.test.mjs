import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

function getDefaultBrowserActScreenshotDir() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'browseract', 'screenshots');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'browseract', 'screenshots');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'browseract', 'screenshots');
}

test('browser-act tool imports screenshot artifacts into the configured image directory before returning output', async () => {
  const {
    browserActToolPlugin,
  } = require('../dist-electron/main/domains/tools/browser-act-tool.js');

  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-artifacts-'));
  const workspaceDir = join(tempRoot, 'workspace');
  const imageDir = join(tempRoot, 'generated-images');
  const binPath = join(tempRoot, 'fake-browser-act');
  const sourceDir = getDefaultBrowserActScreenshotDir();
  const sourcePath = join(sourceDir, `deepbot-artifact-test-${process.pid}-${Date.now()}.png`);
  const expectedCopyPath = join(imageDir, `browseract-${basename(sourcePath)}`);
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousScreenshot = process.env.FAKE_BROWSER_ACT_SCREENSHOT;

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'binary');
  writeFileSync(binPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'get-skills') {
  console.log('BrowserAct guide loaded');
  process.exit(0);
}
const screenshot = process.env.FAKE_BROWSER_ACT_SCREENSHOT;
console.log('Saved screenshot: ' + screenshot);
console.error('Markdown screenshot: ![shot](' + screenshot + ')');
`, 'utf8');
  chmodSync(binPath, 0o755);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_SCREENSHOT = sourcePath;

  const fakeConfigStore = {
    getWorkspaceSettings() {
      return {
        workspaceDir,
        workspaceDirs: [workspaceDir],
        scriptDir: join(tempRoot, 'scripts'),
        skillDirs: [join(tempRoot, 'skills')],
        defaultSkillDir: join(tempRoot, 'skills'),
        imageDir,
        memoryDir: join(tempRoot, 'memory'),
        sessionDir: join(tempRoot, 'sessions'),
      };
    },
  };

  try {
    const tool = browserActToolPlugin.create({
      workspaceDir,
      sessionId: 'browser-act-artifacts-test',
      configStore: fakeConfigStore,
    });

    const guide = await tool.execute('call-guide', {
      args: ['get-skills', 'core', '--skill-version', '2.0.2'],
    });
    assert.equal(guide.isError, false);

    const result = await tool.execute('call-screenshot', {
      args: ['--session', 'merchant-demo', 'screenshot'],
    });

    assert.equal(result.isError, false);
    const text = result.content[0].text;
    assert.doesNotMatch(text, new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(expectedCopyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(result.details.browserActArtifacts, [expectedCopyPath]);
    assert.deepEqual(readFileSync(expectedCopyPath), readFileSync(sourcePath));

    const missingPath = join(sourceDir, `deepbot-artifact-missing-${process.pid}-${Date.now()}.png`);
    process.env.FAKE_BROWSER_ACT_SCREENSHOT = missingPath;
    const missingResult = await tool.execute('call-missing-screenshot', {
      args: ['--session', 'merchant-demo', 'screenshot'],
    });

    assert.equal(missingResult.isError, false);
    const missingText = missingResult.content[0].text;
    assert.doesNotMatch(missingText, new RegExp(missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(missingText, /BrowserAct artifact unavailable: deepbot-artifact-missing-/);
    assert.deepEqual(missingResult.details.browserActArtifacts, []);
    assert.match(missingResult.details.browserActArtifactWarnings.join('\n'), /Failed to import BrowserAct artifact/);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousScreenshot === undefined) {
      delete process.env.FAKE_BROWSER_ACT_SCREENSHOT;
    } else {
      process.env.FAKE_BROWSER_ACT_SCREENSHOT = previousScreenshot;
    }
    rmSync(sourcePath, { force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
