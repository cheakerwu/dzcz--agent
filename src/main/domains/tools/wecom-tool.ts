/**
 * 企业微信工具（插件）
 *
 * 提供三个工具：
 * - wecom_send_message：向企业微信用户/群发送文本消息
 * - wecom_send_image：向企业微信用户/群发送图片
 * - wecom_send_file：向企业微信用户/群发送文件
 */

import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { expandUserPath } from '../../../shared/utils/path-utils';
import type { Gateway } from '../../infrastructure/gateway/gateway';
import { TOOL_NAMES } from './tool-names';
import { createLogger } from '../../../shared/utils/logger';

const logger = createLogger('WecomTool');

let gatewayInstance: Gateway | null = null;

export function setGatewayForWecomTool(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 解析企业微信发送目标
 * 
 * 优先级：
 * 1. 提供了 tabName → 查找对应 Tab 的 conversationId
 * 2. 提供了 userid → 构建 single:{userid}
 * 3. 当前 Tab 是企业微信 connector → 直接用当前会话
 */
function resolveWecomTarget(sessionId: string, userid?: string, tabName?: string): { conversationId: string; connectorId: string } {
  if (!gatewayInstance) throw new Error('Gateway 未初始化');

  // 情况 1：提供了 tabName
  if (tabName) {
    const tabs = gatewayInstance.getAllTabs();
    const normalizedQuery = tabName.replace(/\s+/g, '');
    const targetTab = tabs.find(t => t.title.replace(/\s+/g, '') === normalizedQuery);
    if (!targetTab) throw new Error(`未找到名为 "${tabName}" 的 Tab`);
    if (!targetTab.connectorId?.startsWith('wecom') || !targetTab.conversationId) {
      throw new Error(`Tab "${tabName}" 不是企业微信会话 Tab`);
    }
    return { conversationId: targetTab.conversationId, connectorId: targetTab.connectorId };
  }

  // 情况 2：提供了 userid
  if (userid) {
    // 找到第一个可用的企业微信连接器
    const tabs = gatewayInstance.getAllTabs();
    const currentTab = tabs.find(t => t.id === sessionId);
    const connectorId = currentTab?.connectorId?.startsWith('wecom') ? currentTab.connectorId : findFirstWecomConnectorId();
    return { conversationId: `single:${userid}`, connectorId };
  }

  // 情况 3：当前 Tab 是企业微信 connector
  const tabs = gatewayInstance.getAllTabs();
  const currentTab = tabs.find(t => t.id === sessionId);
  if (currentTab?.type === 'connector' && currentTab.connectorId?.startsWith('wecom') && currentTab.conversationId) {
    return { conversationId: currentTab.conversationId, connectorId: currentTab.connectorId };
  }

  throw new Error('无法确定发送目标。请提供 userid 或 tabName 参数，或在企业微信会话 Tab 中调用');
}

/**
 * 查找第一个可用的企业微信连接器 ID
 */
function findFirstWecomConnectorId(): string {
  if (!gatewayInstance) return 'wecom-1';
  const connectorManager = gatewayInstance.getConnectorManager();
  const allConnectors = connectorManager.getAllConnectors();
  const wecomConnector = allConnectors.find(c => c.id.startsWith('wecom'));
  return wecomConnector?.id || 'wecom-1';
}

// ── 工具插件 ──────────────────────────────────────────────────────────────────

export const wecomToolPlugin: ToolPlugin = {
  metadata: {
    id: 'wecom',
    name: '企业微信消息',
    version: '1.0.0',
    description: '向企业微信用户或群发送文本消息、图片、文件',
    author: 'Local Agent Contributors',
    category: 'network',
    tags: ['wecom', 'message', 'image', 'file'],
    requiresConfig: false,
  },

  create: (_options: ToolCreateOptions) => {
    const sessionId = (_options as any).sessionId as string | undefined;

    return [
      // ── wecom_send_message ──────────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_SEND_MESSAGE,
        label: '发送企业微信消息',
        description: '向企业微信用户或群发送文本消息。在企业微信会话中调用时，默认发给当前会话。',
        parameters: Type.Object({
          message: Type.String({ description: '要发送的文本消息内容' }),
          userid: Type.Optional(Type.String({ description: '目标用户 ID（单聊时使用）' })),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const target = resolveWecomTarget(sessionId, args.userid, args.tabName);
            logger.info('发送企业微信消息:', { target, messageLength: args.message.length });

            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendOutgoingMessage(target.connectorId, target.conversationId, args.message);

            return {
              content: [{ type: 'text', text: '✅ 企业微信消息已发送' }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },

      // ── wecom_send_image ────────────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_SEND_IMAGE,
        label: '发送企业微信图片',
        description: '向企业微信用户或群发送图片。支持本地图片路径。',
        parameters: Type.Object({
          imagePath: Type.String({ description: '图片文件路径，支持 ~ 符号' }),
          userid: Type.Optional(Type.String({ description: '目标用户 ID' })),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const expandedPath = expandUserPath(args.imagePath);
            if (!existsSync(expandedPath)) throw new Error(`图片文件不存在: ${args.imagePath}`);

            const target = resolveWecomTarget(sessionId, args.userid, args.tabName);
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendImage(target.connectorId, target.conversationId, expandedPath);

            return {
              content: [{ type: 'text', text: '✅ 企业微信图片已发送' }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },

      // ── wecom_send_file ─────────────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_SEND_FILE,
        label: '发送企业微信文件',
        description: '向企业微信用户或群发送文件。支持本地文件路径。',
        parameters: Type.Object({
          filePath: Type.String({ description: '文件路径，支持 ~ 符号' }),
          fileName: Type.Optional(Type.String({ description: '文件名（可选，默认使用原文件名）' })),
          userid: Type.Optional(Type.String({ description: '目标用户 ID' })),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const expandedPath = expandUserPath(args.filePath);
            if (!existsSync(expandedPath)) throw new Error(`文件不存在: ${args.filePath}`);

            const target = resolveWecomTarget(sessionId, args.userid, args.tabName);
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendFile(target.connectorId, target.conversationId, expandedPath, args.fileName);

            return {
              content: [{ type: 'text', text: `✅ 企业微信文件已发送: ${args.fileName || basename(expandedPath)}` }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },
    ];
  },
};
