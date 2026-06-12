/**
 * MCP 适配器 ToolPlugin
 *
 * 职责：
 * - 读取 MCP 配置，连接 MCP Server
 * - 将 MCP Server 暴露的工具转换为 AgentTool
 * - 提供 mcp_adapter 管理工具（查看状态、重连）
 *
 * 工具命名：mcp__<serverName>__<toolName>
 */

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from '../registry/tool-interface';

/**
 * 安全日志：捕获 EPIPE 防止崩溃
 * Electron 主进程 stdout 可能是管道，管道断开时 console.log 会抛 EPIPE
 */
function safeLog(...args: any[]): void {
  try { console.log(...args); } catch (e: any) { if (e?.code !== 'EPIPE') throw e; }
}
function safeWarn(...args: any[]): void {
  try { console.warn(...args); } catch (e: any) { if (e?.code !== 'EPIPE') throw e; }
}
function safeError(...args: any[]): void {
  try { console.error(...args); } catch (e: any) { if (e?.code !== 'EPIPE') throw e; }
}
import { TOOL_NAMES } from '../tool-names';
import { loadMcpConfig, getEnabledServers } from './mcp-config';
import { McpClient } from './mcp-client';
import type { McpToolInfo, McpServerInfo } from './types';

/**
 * JSON Schema → TypeBox schema 转换（简化版，覆盖常见类型）
 */
function jsonSchemaToTypeBox(schema: Record<string, any>): any {
  const { Type: T } = require('@sinclair/typebox');

  if (!schema || schema.type !== 'object' || !schema.properties) {
    return T.Object({});  // 无参数时返回空对象
  }

  const properties: Record<string, any> = {};
  const required = new Set<string>(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
    let field: any;

    switch (prop.type) {
      case 'string':
        field = T.String({ description: prop.description || '' });
        break;
      case 'number':
      case 'integer':
        field = T.Number({ description: prop.description || '' });
        if (prop.minimum !== undefined) field = T.Number({ description: prop.description || '', minimum: prop.minimum });
        if (prop.maximum !== undefined) field = T.Number({ description: prop.description || '', maximum: prop.maximum });
        break;
      case 'boolean':
        field = T.Boolean({ description: prop.description || '' });
        break;
      case 'array':
        field = T.Array(T.Any(), { description: prop.description || '' });
        break;
      case 'object':
        field = T.Object({}, { description: prop.description || '' });
        break;
      default:
        field = T.Any({ description: prop.description || '' });
    }

    // 非必填字段用 Optional 包装
    if (!required.has(key)) {
      field = T.Optional(field);
    }

    properties[key] = field;
  }

  return T.Object(properties);
}

/**
 * 全局 MCP 客户端管理
 */
const clients: Map<string, McpClient> = new Map();

/**
 * 创建 MCP 管理工具（mcp_adapter）
 */
function createMcpManagerTool(): AgentTool {
  return {
    name: TOOL_NAMES.MCP_ADAPTER,
    label: 'MCP Adapter',
    description: `MCP 适配器管理工具，用于查看 MCP Server 状态和管理连接。

功能：
- status: 查看所有 MCP Server 的连接状态和工具数量
- list-tools: 列出所有 MCP Server 暴露的工具
- reconnect: 重新连接指定的 MCP Server
- disconnect: 断开指定的 MCP Server`,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('status'),
        Type.Literal('list-tools'),
        Type.Literal('reconnect'),
        Type.Literal('disconnect'),
      ], { description: '操作类型' }),
      server: Type.Optional(Type.String({ description: 'Server 名称（reconnect/disconnect 操作必填）' })),
    }),
    execute: async (_toolCallId, params) => {
      const { action, server } = params as { action: string; server?: string };

      let result: any;

      switch (action) {
        case 'status': {
          const infos: McpServerInfo[] = [];
          for (const [name, client] of clients) {
            infos.push(client.getInfo());
          }
          result = {
            servers: infos,
            total: infos.length,
            connected: infos.filter(i => i.status === 'connected').length,
            totalTools: infos.reduce((sum, i) => sum + i.toolCount, 0),
          };
          break;
        }

        case 'list-tools': {
          const allTools: McpToolInfo[] = [];
          for (const client of clients.values()) {
            allTools.push(...client.getTools());
          }
          result = {
            tools: allTools.map(t => ({
              name: `mcp__${t.serverName}__${t.name}`,
              description: t.description,
              server: t.serverName,
            })),
            count: allTools.length,
          };
          break;
        }

        case 'reconnect': {
          if (!server) throw new Error('缺少参数: server');
          const client = clients.get(server);
          if (!client) throw new Error(`MCP Server "${server}" 不存在`);
          await client.disconnect();
          await client.connect();
          result = client.getInfo();
          break;
        }

        case 'disconnect': {
          if (!server) throw new Error('缺少参数: server');
          const client = clients.get(server);
          if (!client) throw new Error(`MCP Server "${server}" 不存在`);
          await client.disconnect();
          result = { success: true, message: `已断开 "${server}"` };
          break;
        }

        default:
          throw new Error(`未知操作: ${action}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}

/**
 * 为单个 MCP 工具创建 AgentTool
 */
function createMcpTool(mcpTool: McpToolInfo, client: McpClient): AgentTool {
  const toolName = `mcp__${mcpTool.serverName}__${mcpTool.name}`;

  return {
    name: toolName,
    label: `MCP: ${mcpTool.name}`,
    description: `[MCP:${mcpTool.serverName}] ${mcpTool.description}`,
    parameters: jsonSchemaToTypeBox(mcpTool.inputSchema),
    execute: async (_toolCallId, params) => {
      try {
        const result = await client.callTool(mcpTool.name, params as Record<string, any>);

        // MCP 返回格式与 AgentTool 格式兼容
        if (result && Array.isArray(result.content)) {
          return {
            content: result.content.map((c: any) => {
              if (c.type === 'text') return { type: 'text' as const, text: c.text };
              if (c.type === 'image') return { type: 'image' as const, data: c.data, mimeType: c.mimeType };
              return { type: 'text' as const, text: JSON.stringify(c) };
            }),
            details: result,
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `MCP 工具调用失败: ${errorMsg}` }],
          details: { error: errorMsg },
          isError: true,
        };
      }
    },
  };
}

// ── ToolPlugin 导出 ──────────────────────────────────────────────────────────

export const mcpAdapterToolPlugin: ToolPlugin = {
  metadata: {
    id: 'mcp-adapter',
    name: 'MCP 适配器',
    version: '1.0.0',
    description: '连接 MCP Server，将外部工具注册为 Agent 可调用的工具',
    author: 'Local Agent Contributors',
    category: 'network',
    tags: ['mcp', 'adapter', 'protocol', 'external-tools'],
  },

  create: async (_options: ToolCreateOptions): Promise<AgentTool[]> => {
    const tools: AgentTool[] = [];

    // 1. 添加管理工具
    tools.push(createMcpManagerTool());

    // 2. 读取配置并连接 MCP Servers
    const config = loadMcpConfig();
    const enabledServers = getEnabledServers(config);

    if (enabledServers.length === 0) {
      safeLog('[MCP Adapter] ℹ️ 未配置 MCP Server（配置文件: ~/.deepbot/mcp-config.json）');
      return tools;
    }

    safeLog(`[MCP Adapter] 🔌 正在连接 ${enabledServers.length} 个 MCP Server...`);

    // 3. 并行连接所有 server
    const connectPromises = enabledServers.map(async ({ name, config: serverConfig }) => {
      const client = new McpClient(name, serverConfig);
      clients.set(name, client);

      try {
        await client.connect();
        const mcpTools = client.getTools();

        // 为每个 MCP 工具创建 AgentTool
        for (const mcpTool of mcpTools) {
          tools.push(createMcpTool(mcpTool, client));
        }
      } catch (error) {
        safeError(`[MCP Adapter] ❌ Server "${name}" 初始化失败:`, error);
      }
    });

    await Promise.allSettled(connectPromises);

    const totalTools = tools.length - 1; // 减去管理工具
    safeLog(`[MCP Adapter] ✅ MCP 适配器加载完成: ${totalTools} 个外部工具`);

    return tools;
  },

  cleanup: async () => {
    for (const [name, client] of clients) {
      try {
        await client.disconnect();
      } catch (error) {
        safeWarn(`[MCP Adapter] ⚠️ 断开 "${name}" 失败:`, error);
      }
    }
    clients.clear();
  },
};
