/**
 * MCP 协议客户端
 *
 * 封装与单个 MCP Server 的通信：
 * - stdio 传输（spawn 子进程）
 * - SSE / Streamable HTTP 传输
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpToolInfo, McpServerStatus, McpServerInfo } from './types';

/**
 * 安全日志：忽略 EPIPE 错误
 * Electron 主进程的 stdout 可能是管道，当管道断开时 console.log 会抛 EPIPE
 */
function safeLog(...args: any[]): void {
  try {
    console.log(...args);
  } catch (error: any) {
    if (error?.code !== 'EPIPE') {
      // 非 EPIPE 错误重新抛出
      process.stderr.write(`[MCP Adapter] log error: ${error?.message}\n`);
    }
  }
}

function safeWarn(...args: any[]): void {
  try {
    console.warn(...args);
  } catch (error: any) {
    if (error?.code !== 'EPIPE') {
      process.stderr.write(`[MCP Adapter] warn error: ${error?.message}\n`);
    }
  }
}

function safeError(...args: any[]): void {
  try {
    console.error(...args);
  } catch (error: any) {
    if (error?.code !== 'EPIPE') {
      process.stderr.write(`[MCP Adapter] error error: ${error?.message}\n`);
    }
  }
}

/**
 * MCP 客户端，管理与单个 MCP Server 的连接
 */
export class McpClient {
  private serverName: string;
  private config: McpServerConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private tools: McpToolInfo[] = [];
  private status: McpServerStatus = 'disconnected';
  private errorMsg: string | undefined;
  private processExitHandler: (() => void) | null = null;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  /**
   * 连接到 MCP Server
   */
  async connect(): Promise<void> {
    if (this.status === 'connected') return;

    this.status = 'connecting';
    this.errorMsg = undefined;

    try {
      // 创建 MCP Client
      this.client = new Client(
        { name: 'dianbot-mcp-client', version: '1.0.0' },
        { capabilities: {} }
      );

      // 根据配置选择传输方式
      if (this.config.command) {
        // stdio 传输 — stderr 使用 'inherit' 避免管道断裂导致 EPIPE
        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env,
          stderr: 'inherit',
        });
      } else if (this.config.url) {
        // 尝试 Streamable HTTP，失败后降级到 SSE
        const url = new URL(this.config.url);
        const headers = this.config.headers;

        try {
          this.transport = new StreamableHTTPClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          });
        } catch {
          // 降级到 SSE
          this.transport = new SSEClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          });
        }
      } else {
        throw new Error('配置缺少 command（stdio 模式）或 url（HTTP 模式）');
      }

      // 连接
      await this.client.connect(this.transport);

      // 获取工具列表
      const result = await this.client.listTools();
      this.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as Record<string, any>,
        serverName: this.serverName,
      }));

      this.status = 'connected';

      // 监听进程退出（stdio 模式下子进程崩溃时自动标记断开）
      if (this.transport && 'stderr' in this.transport) {
        const transportAny = this.transport as any;
        if (transportAny._process) {
          this.processExitHandler = () => {
            if (this.status === 'connected') {
              this.status = 'error';
              this.errorMsg = '子进程已退出';
              this.tools = [];
              safeWarn(`[MCP Adapter] ⚠️ Server "${this.serverName}" 子进程已退出`);
            }
          };
          transportAny._process.on('exit', this.processExitHandler);
          transportAny._process.on('error', (err: Error) => {
            if (err && (err as any).code !== 'EPIPE') {
              safeWarn(`[MCP Adapter] ⚠️ Server "${this.serverName}" 进程错误:`, err.message);
            }
          });
        }
      }

      safeLog(`[MCP Adapter] ✅ 已连接 "${this.serverName}"，发现 ${this.tools.length} 个工具`);
    } catch (error) {
      this.status = 'error';
      this.errorMsg = error instanceof Error ? error.message : String(error);
      safeError(`[MCP Adapter] ❌ 连接 "${this.serverName}" 失败:`, this.errorMsg);
      // 清理失败的连接
      await this.cleanup();
    }
  }

  /**
   * 获取发现的工具列表
   */
  getTools(): McpToolInfo[] {
    return this.tools;
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (!this.client || this.status !== 'connected') {
      throw new Error(`MCP Server "${this.serverName}" 未连接`);
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    await this.cleanup();
    this.status = 'disconnected';
    this.tools = [];
    safeLog(`[MCP Adapter] 🔌 已断开 "${this.serverName}"`);
  }

  /**
   * 获取 Server 状态信息
   */
  getInfo(): McpServerInfo {
    return {
      name: this.serverName,
      status: this.status,
      toolCount: this.tools.length,
      error: this.errorMsg,
    };
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.status === 'connected';
  }

  /**
   * 内部清理
   */
  private async cleanup(): Promise<void> {
    // 移除进程退出监听
    if (this.processExitHandler && this.transport) {
      try {
        const transportAny = this.transport as any;
        if (transportAny._process) {
          transportAny._process.removeListener('exit', this.processExitHandler);
        }
      } catch {
        // 忽略
      }
      this.processExitHandler = null;
    }

    try {
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
    } catch {
      // 忽略关闭错误
    }
    this.client = null;
  }
}
