/**
 * 处理函数通用工具
 * 消除重复代码，提供统一的工具函数
 */

import { getErrorMessage } from '../../../shared/utils/error-handler';
import { createLogger } from '../../../shared/utils/logger';

// ==================== 类型定义 ====================

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: any;
  isError?: boolean;
}

// ==================== 日志记录器 ====================

const logger = createLogger('API-Tool-Handlers');

// ==================== 通用工具函数 ====================

/**
 * 检查 AbortSignal 是否被取消
 */
export function checkAbortSignal(signal: AbortSignal | undefined, operationName: string): void {
  if (signal?.aborted) {
    const err = new Error(`${operationName}操作被取消`);
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * 获取 SystemConfigStore 实例
 */
export async function getSystemConfigStore() {
  const { SystemConfigStore } = await import('../../database/system-config-store');
  return SystemConfigStore.getInstance();
}

/**
 * 创建成功响应
 */
export function createSuccessResponse(text: string, details: any): ToolResult {
  return {
    content: [{ type: 'text', text }],
    details: { success: true, ...details },
  };
}

/**
 * 创建错误响应
 */
export function createErrorResponse(error: unknown, operationName: string): ToolResult {
  const errorMessage = getErrorMessage(error);
  logger.error(`${operationName}失败:`, error);
  
  return {
    content: [{ type: 'text', text: `❌ ${operationName}失败: ${errorMessage}` }],
    details: { success: false, error: errorMessage },
    isError: true,
  };
}

/**
 * 获取 Gateway 实例
 */
export async function getGatewayInstance() {
  const { getGatewayInstance } = await import('../../gateway');
  return getGatewayInstance();
}

/**
 * 发送事件到前端窗口
 * 通过 Gateway 主窗口发送，兼容 Electron 和 Web 模式：
 * - Electron 模式：mainWindow 是真实的 BrowserWindow
 * - Web 模式：mainWindow 是虚拟窗口，会转发到 WebSocket
 */
export async function sendToFrontend(eventName: string, data: any): Promise<void> {
  const { getGatewayInstance } = await import('../../gateway');
  const gateway = getGatewayInstance();
  if (!gateway) return;

  const mainWindow = gateway.getMainWindow();
  if (!mainWindow) return;

  const { sendToWindow } = await import('../../../shared/utils/webcontents-utils');
  sendToWindow(mainWindow, eventName, data);
}