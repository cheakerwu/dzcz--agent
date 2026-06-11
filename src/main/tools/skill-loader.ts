/**
 * Skill 动态加载器
 *
 * 职责：
 * - 扫描已安装的 Skill，检查 tools.json 清单
 * - 将 Skill 中定义的工具注册为 AgentTool（命名: skill__<skillName>__<toolName>）
 * - 没有 tools.json 的 Skill 保持原行为（仅系统提示词注入）
 *
 * tools.json 格式：
 * [
 *   {
 *     "name": "search",
 *     "description": "搜索网页",
 *     "parameters": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] },
 *     "command": "python3 search.py",
 *     "timeout": 30000
 *   }
 * ]
 */

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { initDatabase } from './skill-manager/database';
import { listInstalledSkills } from './skill-manager/manage';
import { getAllSkillPaths } from '../config/skill-paths';
import { safeJsonParse } from '../../shared/utils/json-utils';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { execSync, spawn } from 'node:child_process';
import { getSkillEnv } from './skill-manager/manage';

/**
 * Skill 工具定义（来自 tools.json）
 */
interface SkillToolDef {
  /** 工具名（Skill 内唯一） */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 参数定义 */
  parameters?: Record<string, any>;
  /** 执行命令（在 Skill 目录下执行） */
  command: string;
  /** 超时时间（毫秒，默认 60000） */
  timeout?: number;
}

/**
 * 解析 JSON Schema 为 TypeBox schema（简化版）
 */
function parseParametersSchema(schema?: Record<string, any>): any {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return Type.Object({});
  }

  const properties: Record<string, any> = {};
  const required = new Set<string>(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
    let field: any;

    switch (prop.type) {
      case 'string':
        field = Type.String({ description: prop.description || '' });
        break;
      case 'number':
      case 'integer':
        field = Type.Number({ description: prop.description || '' });
        break;
      case 'boolean':
        field = Type.Boolean({ description: prop.description || '' });
        break;
      case 'array':
        field = Type.Array(Type.Any(), { description: prop.description || '' });
        break;
      default:
        field = Type.Any({ description: prop.description || '' });
    }

    if (!required.has(key)) {
      field = Type.Optional(field);
    }

    properties[key] = field;
  }

  return Type.Object(properties);
}

/**
 * 在 Skill 目录下执行命令
 */
function executeSkillCommand(
  skillDir: string,
  command: string,
  input: Record<string, any>,
  envVars: Record<string, string>,
  timeout: number = 60000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // 将参数通过环境变量传入
    const env = {
      ...process.env,
      ...envVars,
      SKILL_INPUT: JSON.stringify(input),
      SKILL_DIR: skillDir,
    };

    const proc = spawn('bash', ['-c', command], {
      cwd: skillDir,
      env,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    // 通过 stdin 传入参数
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * 为单个 Skill 工具定义创建 AgentTool
 */
function createSkillTool(
  skillName: string,
  toolDef: SkillToolDef,
  skillDir: string,
  envVars: Record<string, string>
): AgentTool {
  const toolName = `skill__${skillName}__${toolDef.name}`;
  const timeout = toolDef.timeout || 60000;

  return {
    name: toolName,
    label: `Skill: ${toolDef.name}`,
    description: `[Skill:${skillName}] ${toolDef.description}`,
    parameters: parseParametersSchema(toolDef.parameters),
    execute: async (_toolCallId, params) => {
      try {
        const result = await executeSkillCommand(
          skillDir,
          toolDef.command,
          params as Record<string, any>,
          envVars,
          timeout
        );

        if (result.exitCode !== 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Skill 执行失败 (exit code: ${result.exitCode}):\n${result.stderr || result.stdout}`,
            }],
            details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
            isError: true,
          };
        }

        // 尝试解析 JSON 输出
        let details: any;
        try {
          details = JSON.parse(result.stdout);
        } catch {
          details = { output: result.stdout };
        }

        return {
          content: [{ type: 'text' as const, text: result.stdout }],
          details,
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Skill 执行异常: ${getErrorMessage(error)}` }],
          details: { error: getErrorMessage(error) },
          isError: true,
        };
      }
    },
  };
}

// ── ToolPlugin 导出 ──────────────────────────────────────────────────────────

export const skillLoaderPlugin: ToolPlugin = {
  metadata: {
    id: 'skill-loader',
    name: 'Skill 动态加载器',
    version: '1.0.0',
    description: '扫描已安装 Skill 的 tools.json，将 Skill 工具注册为 Agent 可直接调用的工具',
    author: 'Local Agent Contributors',
    category: 'system',
    tags: ['skill', 'loader', 'dynamic', 'tools'],
  },

  create: async (_options: ToolCreateOptions): Promise<AgentTool[]> => {
    const tools: AgentTool[] = [];

    try {
      const db = initDatabase();
      const installedSkills = listInstalledSkills(db, { enabled: true });

      if (installedSkills.length === 0) {
        console.log('[Skill Loader] ℹ️ 没有已安装的 Skill');
        return tools;
      }

      const skillPaths = getAllSkillPaths();

      for (const skill of installedSkills) {
        // 查找 Skill 目录
        let skillDir: string | null = null;
        for (const basePath of skillPaths) {
          const dir = join(basePath, skill.name);
          if (existsSync(dir)) {
            skillDir = dir;
            break;
          }
        }

        if (!skillDir) continue;

        // 检查 tools.json
        const toolsJsonPath = join(skillDir, 'tools.json');
        if (!existsSync(toolsJsonPath)) continue;

        try {
          const content = readFileSync(toolsJsonPath, 'utf-8');
          const toolDefs = safeJsonParse<SkillToolDef[]>(content, []);

          if (!Array.isArray(toolDefs) || toolDefs.length === 0) continue;

          // 读取 Skill 环境变量
          let envVars: Record<string, string> = {};
          try {
            const envContent = getSkillEnv(skill.name);
            if (envContent) {
              for (const line of envContent.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                  const key = trimmed.substring(0, eqIndex).trim();
                  const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
                  envVars[key] = value;
                }
              }
            }
          } catch {
            // 环境变量读取失败不影响工具加载
          }

          // 为每个工具定义创建 AgentTool
          for (const toolDef of toolDefs) {
            if (!toolDef.name || !toolDef.command) {
              console.warn(`[Skill Loader] ⚠️ Skill "${skill.name}" 的 tools.json 中有无效定义（缺少 name 或 command），跳过`);
              continue;
            }

            tools.push(createSkillTool(skill.name, toolDef, skillDir, envVars));
            console.log(`[Skill Loader] ✅ 注册工具: skill__${skill.name}__${toolDef.name}`);
          }
        } catch (error) {
          console.warn(`[Skill Loader] ⚠️ 解析 Skill "${skill.name}" 的 tools.json 失败:`, error);
        }
      }

      if (tools.length > 0) {
        console.log(`[Skill Loader] ✅ Skill Loader 加载完成: ${tools.length} 个 Skill 工具`);
      }
    } catch (error) {
      console.error('[Skill Loader] ❌ Skill Loader 初始化失败:', error);
    }

    return tools;
  },
};
