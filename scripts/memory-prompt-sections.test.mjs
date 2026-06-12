import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const {
  buildAdminMemorySection,
  buildCoreMemorySection,
  buildFastModeSystemPrompt,
} = require('../dist-electron/main/domains/prompts/memory-sections.js');

test('old Markdown memory is not injected into runtime prompt sections', () => {
  const section = buildCoreMemorySection('旧记忆：人民广场店负责人是小张。', {
    hasAdminMemoryContext: true,
  }).join('\n');

  assert.equal(section, '');
});

test('fast mode prompt includes structured operation context only', () => {
  const adminSection = buildAdminMemorySection('### 企业记忆\n- 企业日报默认先看营业额。').join('\n');
  assert.match(adminSection, /## 运营上下文/);
  assert.match(adminSection, /结构化企业、群聊、个人记忆/);

  const prompt = buildFastModeSystemPrompt({
    agentName: 'DianBot',
    userName: '管理员',
    memoryContent: '旧记忆：人民广场店负责人是小张。',
    adminMemoryContext: '### 企业记忆\n- 企业日报默认先看营业额。',
  });

  assert.match(prompt, /当前处于 Fast 模式/);
  assert.doesNotMatch(prompt, /## 核心记忆/);
  assert.doesNotMatch(prompt, /旧记忆/);
  assert.match(prompt, /## 运营上下文/);
  assert.match(prompt, /企业日报默认先看营业额/);
});
