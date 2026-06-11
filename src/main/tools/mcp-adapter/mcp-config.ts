/**
 * MCP 配置读取
 *
 * 从 ~/.deepbot/mcp-config.json 读取 MCP Server 配置
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { safeJsonParse } from '../../../shared/utils/json-utils';
import type { McpConfig } from './types';

const CONFIG_FILENAME = 'mcp-config.json';

/**
 * 获取 MCP 配置文件路径
 */
function getConfigPath(): string {
  return join(homedir(), '.deepbot', CONFIG_FILENAME);
}

/**
 * 读取 MCP 配置
 * 文件不存在时返回空配置（不报错）
 */
export function loadMcpConfig(): McpConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { servers: {} };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = safeJsonParse<McpConfig>(content, { servers: {} });

    // 基本校验
    if (!config.servers || typeof config.servers !== 'object') {
      console.warn('[MCP Adapter] ⚠️ 配置文件格式错误: servers 字段缺失或非对象');
      return { servers: {} };
    }

    return config;
  } catch (error) {
    console.error('[MCP Adapter] ❌ 读取配置文件失败:', error);
    return { servers: {} };
  }
}

/**
 * 获取启用的 MCP Server 列表（过滤 disabled 的）
 */
export function getEnabledServers(config: McpConfig): Array<{ name: string; config: McpConfig['servers'][string] }> {
  return Object.entries(config.servers)
    .filter(([_, serverConfig]) => !serverConfig.disabled)
    .map(([name, serverConfig]) => ({ name, config: serverConfig }));
}
