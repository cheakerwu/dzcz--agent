const assert = require('node:assert/strict');

const {
  isBrowserActCoreGuideCommand,
  classifyBrowserActCommandRisk,
  requiresBrowserActConfirmation,
  validateBrowserActArgs,
  truncateOutput,
} = require('../dist-electron/main/domains/tools/browser-act-command.js');
const {
  browserActToolPlugin,
} = require('../dist-electron/main/domains/tools/browser-act-tool.js');

assert.equal(
  isBrowserActCoreGuideCommand(['get-skills', 'core', '--skill-version', '2.0.2']),
  true,
  'get-skills core should satisfy the BrowserAct guide prerequisite',
);

assert.equal(
  isBrowserActCoreGuideCommand(['browser', 'open', 'my-browser', 'https://example.com']),
  false,
  'browser commands are not guide-loading commands',
);

assert.equal(
  classifyBrowserActCommandRisk(['--session', 'merchant-demo', 'screenshot']),
  'read_only',
  'screenshot commands should remain read-only',
);

assert.equal(
  classifyBrowserActCommandRisk(['--session', 'merchant-demo', 'click', 'button:保存']),
  'write',
  'clicking a save button should be classified as a write command',
);

assert.equal(
  requiresBrowserActConfirmation(['--session', 'merchant-demo', 'click', 'button:保存']),
  true,
  'write commands must require confirmation',
);

assert.doesNotThrow(() => {
  validateBrowserActArgs(['--session', 'merchant-demo', 'browser', 'open', 'my-browser', 'https://example.com']);
});

assert.throws(
  () => validateBrowserActArgs(['browser', 'delete', 'my-browser']),
  /blocked BrowserAct infrastructure command: browser delete/,
);

assert.throws(
  () => validateBrowserActArgs(['proxy', 'buy-request']),
  /blocked BrowserAct infrastructure command: proxy buy-request/,
);

assert.equal(
  truncateOutput('abcdef', 4),
  'abcd\n...<truncated 2 chars>',
);

async function runToolTests() {
  const tool = browserActToolPlugin.create({
    workspaceDir: process.cwd(),
    sessionId: 'browser-act-test',
  });

  const guideRequired = await tool.execute('call-1', {
    args: ['--session', 'merchant-demo', 'browser', 'open', 'my-browser', 'https://example.com'],
  });

  assert.equal(guideRequired.isError, true);
  assert.equal(guideRequired.details.guideRequired, true);

  const blocked = await tool.execute('call-2', {
    args: ['browser', 'delete', 'my-browser'],
  });

  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /blocked BrowserAct infrastructure command: browser delete/);
}

runToolTests()
  .then(() => {
    console.log('browser-act command and tool tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
