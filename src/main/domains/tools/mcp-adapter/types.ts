/**
 * MCP 适配器类型定义
 */

/**
 * 单个 MCP Server 配置
 */
export interface McpServerConfig {
  /** stdio 模式：可执行命令 */
  command?: string;
  /** stdio 模式：命令参数 */
  args?: string[];
  /** 环境变量（会与默认环境合并） */
  env?: Record<string, string>;
  /** SSE / Streamable HTTP 模式：服务端 URL */
  url?: string;
  /** SSE / HTTP 请求头 */
  headers?: Record<string, string>;
  /** 是否禁用此 server（默认 false） */
  disabled?: boolean;
}

/**
 * MCP 配置文件格式（~/.deepbot/mcp-config.json）
 */
export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

/**
 * 从 MCP Server 发现的工具信息
 */
export interface McpToolInfo {
  /** MCP 工具名（server 内唯一） */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: Record<string, any>;
  /** 所属 server 名称 */
  serverName: string;
}

/**
 * MCP Server 连接状态
 */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * MCP Server 运行时信息
 */
export interface McpServerInfo {
  name: string;
  status: McpServerStatus;
  toolCount: number;
  error?: string;
}
