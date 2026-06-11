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
} = require('../dist-electron/main/prompts/memory-sections.js');

test('core memory is demoted when structured admin memory is available', () => {
  const section = buildCoreMemorySection('旧记忆：人民广场店负责人是小张。', {
    hasAdminMemoryContext: true,
  }).join('\n');

  assert.match(section, /如果核心记忆与运营记忆控制平面冲突，以运营记忆控制平面为准/);
  assert.match(section, /核心记忆主要用于个人偏好、交互习惯和错误总结/);
  assert.match(section, /旧记忆：人民广场店负责人是小张/);
});

test('fast mode prompt includes structured admin memory with priority guidance', () => {
  const adminSection = buildAdminMemorySection('可用运营记忆:\n- [store] 人民广场店负责人是小李。').join('\n');
  assert.match(adminSection, /业务事实、门店关系、员工权限和浏览器登录态引用以本节为准/);

  const prompt = buildFastModeSystemPrompt({
    agentName: 'DianBot',
    userName: '管理员',
    memoryContent: '旧记忆：人民广场店负责人是小张。',
    adminMemoryContext: '可用运营记忆:\n- [store] 人民广场店负责人是小李。',
  });

  assert.match(prompt, /当前处于 Fast 模式/);
  assert.match(prompt, /## 核心记忆/);
  assert.match(prompt, /## 运营记忆控制平面/);
  assert.match(prompt, /如果核心记忆与运营记忆控制平面冲突，以运营记忆控制平面为准/);
  assert.match(prompt, /人民广场店负责人是小李/);
});
