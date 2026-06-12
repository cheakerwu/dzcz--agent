/**
 * 系统提示词构建器
 *
 * 职责：
 * - 构建完整的系统提示词
 * - 支持 extraSystemPrompt 注入
 * - 集成核心记忆
 *
 * @description 点之出众餐饮智能工作台 - 系统提示词模块
 */

import type { SystemPromptParams } from '../../../types/prompt';
import { buildTimeSection } from './sections/time';
import { buildContextSection } from './sections/context';
import { buildRuntimeSection } from './sections/runtime';
import { buildAdminMemoryPromptContextForSession } from '../admin-control-plane/prompt-context';
import { listInstalledSkills } from '../tools/skill-manager/manage';
import { initDatabase } from '../tools/skill-manager/database';

/**
 * 构建系统提示词
 * 
 * @param params 提示词参数
 * @param sessionId 会话 ID（用于加载对应的 memory）
 * @returns 完整的系统提示词
 */
export async function buildSystemPrompt(params: SystemPromptParams, sessionId?: string): Promise<string> {
  const lines: string[] = [];

  // 1. 名字配置（最优先）
  const { SystemConfigStore } = await import('../../infrastructure/database/system-config-store');
  const configStore = SystemConfigStore.getInstance();
  const nameConfig = configStore.getNameConfig();
  
  // 🔥 检查是否有 Tab 独立的 Agent 名字
  let agentName = nameConfig.agentName;
  if (sessionId && sessionId !== 'default') {
    const tabConfig = configStore.getTabConfig(sessionId);
    if (tabConfig?.agentName) {
      agentName = tabConfig.agentName;
    }
  }
  
  lines.push('## 身份信息', '');
  lines.push(`你的名字: ${agentName}`);
  lines.push(`用户称呼: ${nameConfig.userName}`);
  lines.push('');
  
  // 工作目录信息已移除（由代码层面控制，不需要在提示词中告知 AI，避免破坏缓存）
  
  lines.push('');

  // 2. 时间信息（已移至每条用户消息的 systemHint 动态注入，保持系统提示词静态可 cache）

  // 3. 项目上下文（AGENT.md, TOOLS.md, MEMORY-TRIGGER.md 等）
  if (params.contextFiles && params.contextFiles.length > 0) {
    lines.push(...buildContextSection(params.contextFiles));
  }

  // 5. 结构化运营上下文（从管理后台控制平面按会话/发送者/门店范围加载）
  try {
    const adminMemoryContext = buildAdminMemoryPromptContextForSession(sessionId);
    if (adminMemoryContext.trim().length > 0) {
      lines.push(
        '## 运营上下文',
        '',
        '**范围约束**：以下内容来自结构化企业、群聊、个人记忆，以及受控浏览器登录态能力引用。只在当前会话、发送者和绑定门店范围内使用。',
        '**优先级**：业务事实、门店关系、员工权限和浏览器登录态引用以本节为准；旧 Markdown 记忆不是运行时事实来源。',
        '',
        adminMemoryContext,
        ''
      );
    }
  } catch (error) {
    console.warn('⚠️ 加载运营上下文失败:', error);
  }

  // 5. 额外提示（动态注入点）
  if (params.extraSystemPrompt) {
    lines.push('## 额外指导', '', params.extraSystemPrompt, '');
  }

  // 6. 运行时信息（已移至每条用户消息的 systemHint 动态注入，保持系统提示词静态可 cache）

  // 8. 已安装的 Skills（智能客服 Tab 只组装白名单中的 Skill）
  try {
    const db = initDatabase();
    let skills = listInstalledSkills(db, { enabled: true });
    
    // 智能客服 Tab：按 Skill 白名单过滤
    if (sessionId) {
      const tabConfig = configStore.getTabConfig(sessionId);
      // 检查是否是智能客服 Tab
      let isSmartKf = false;
      try {
        const { getGatewayInstance } = require('../../infrastructure/gateway/gateway');
        const gateway = getGatewayInstance();
        if (gateway) {
          const tab = gateway.getTabManager().getAllTabs().find((t: any) => t.id === sessionId);
          isSmartKf = tab?.connectorId === 'smart-kf';
        }
      } catch { /* 静默处理 */ }
      
      if (isSmartKf) {
        const whitelist = tabConfig?.skillWhitelist;
        if (whitelist && whitelist.length > 0) {
          skills = skills.filter(s => whitelist.includes(s.name));
        } else {
          skills = []; // 未设置白名单时不组装任何 Skill
        }
      }
    }
    
    if (skills.length > 0) {
      lines.push('## Skills', '');
      lines.push('```json');
      lines.push(JSON.stringify(
        skills.map(s => ({ name: s.name, description: s.description || '', type: 'skill' })),
        null, 2
      ));
    }
  } catch (error) {
    // Skills 加载失败不影响主流程
  }

  // 注意：工作提示词不在 systemPrompt 中注入，而是通过 Agent 的 transformContext hook
  // 在每次 LLM 调用前作为消息注入，放在 tools 定义之后，最大化前缀缓存命中率

  const prompt = lines.filter(Boolean).join('\n');

  return prompt;
}
