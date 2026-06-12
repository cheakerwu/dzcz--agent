import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const { AgentRuntime } = require('../dist-electron/main/domains/agent-runtime/agent-runtime.js');
const {
  SESSION_STOP_BOUNDARY_MARKER,
} = require('../dist-electron/main/domains/agent-runtime/session-boundary.js');
const { SessionManager } = require('../dist-electron/main/domains/sessions/session-manager.js');

test('restored session history keeps tool context when there is no stop boundary', () => {
  const convertSessionMessagesToAgentMessages =
    AgentRuntime.prototype.convertSessionMessagesToAgentMessages;

  const converted = convertSessionMessagesToAgentMessages.call(
    { runtimeConfig: { model: { id: 'test-model' } } },
    [
      {
        role: 'user',
        content: '上一条复杂任务',
        timestamp: 1,
      },
      {
        role: 'assistant',
        content: '任务被用户停止前已经调用过工具',
        timestamp: 2,
        executionSteps: [
          {
            id: 'call_stopped_browser_act',
            toolName: 'browser_act',
            params: { action: 'click' },
            result: 'stopped',
            status: 'running',
            timestamp: 2,
          },
        ],
      },
    ],
  );

  assert.equal(converted.length, 3);
  assert.equal(converted[0].role, 'user');
  assert.equal(converted[1].role, 'assistant');
  assert.ok(Array.isArray(converted[1].content));
  assert.equal(
    converted[1].content.some((part) => part.type === 'toolCall'),
    true,
  );
  assert.equal(converted[2].role, 'toolResult');
});

test('restored session history starts after stop boundary instead of continuing stopped tool work', () => {
  const convertSessionMessagesToAgentMessages =
    AgentRuntime.prototype.convertSessionMessagesToAgentMessages;

  const converted = convertSessionMessagesToAgentMessages.call(
    { runtimeConfig: { model: { id: 'test-model' } } },
    [
      {
        role: 'user',
        content: '上一条复杂任务',
        timestamp: 1,
      },
      {
        role: 'assistant',
        content: '任务被用户停止前已经调用过工具',
        timestamp: 2,
        executionSteps: [
          {
            id: 'call_stopped_browser_act',
            toolName: 'browser_act',
            params: { action: 'click' },
            result: 'stopped',
            status: 'running',
            timestamp: 2,
          },
        ],
      },
      {
        role: 'system',
        content: SESSION_STOP_BOUNDARY_MARKER,
        timestamp: 3,
      },
      {
        role: 'user',
        content: '你好',
        timestamp: 4,
      },
    ],
  );

  assert.equal(converted.length, 1);
  assert.equal(converted[0].role, 'user');
  assert.deepEqual(converted[0].content, [{ type: 'text', text: '你好' }]);
  assert.equal(converted.some((message) => message.role === 'toolResult'), false);
});

test('session context loading preserves stop boundary for runtime conversion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-session-boundary-'));
  const sessionManager = new SessionManager(dir);

  try {
    await sessionManager.initialize();
    await sessionManager.saveUserMessage('tab-stop', '上一条复杂任务');
    await sessionManager.saveAssistantMessage(
      'tab-stop',
      '任务被用户停止前已经调用过工具',
      [
        {
          id: 'call_stopped_browser_act',
          toolName: 'browser_act',
          params: { action: 'click' },
          result: 'stopped',
          status: 'running',
          timestamp: 2,
        },
      ],
    );
    await sessionManager.saveSystemMessage('tab-stop', SESSION_STOP_BOUNDARY_MARKER);
    await sessionManager.saveUserMessage('tab-stop', '你好');

    const contextMessages = await sessionManager.loadContextMessages('tab-stop');
    assert.equal(
      contextMessages.some((message) => message.content === SESSION_STOP_BOUNDARY_MARKER),
      true,
    );

    const convertSessionMessagesToAgentMessages =
      AgentRuntime.prototype.convertSessionMessagesToAgentMessages;
    const converted = convertSessionMessagesToAgentMessages.call(
      { runtimeConfig: { model: { id: 'test-model' } } },
      contextMessages,
    );

    assert.equal(converted.length, 1);
    assert.equal(converted[0].role, 'user');
    assert.deepEqual(converted[0].content, [{ type: 'text', text: '你好' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
