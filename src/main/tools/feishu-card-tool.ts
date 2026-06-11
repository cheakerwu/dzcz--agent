/**
 * 飞书消息卡片工具
 *
 * 提供飞书交互卡片的发送和更新功能，用于：
 * - 每日经营数据卡片推送
 * - 预警通知卡片
 * - 一键采集按钮交互
 *
 * 依赖飞书连接器配置中的 appId / appSecret
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { TOOL_NAMES } from './tool-names';
import { createLogger } from '../../shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('FeishuCardTool');

// 全局 configStore 引用
let configStoreInstance: any = null;

// 缓存的 lark Client 实例
let cachedClient: any = null;
let cachedClientKey: string = '';

/**
 * 注入 configStore（由 gateway.ts 调用）
 */
export function setConfigStoreForFeishuCardTool(store: any): void {
  configStoreInstance = store;
  cachedClient = null;
  cachedClientKey = '';
}

/**
 * 获取飞书 lark Client（带缓存）
 */
async function getLarkClient(): Promise<any> {
  if (!configStoreInstance) {
    throw new Error('configStore 未初始化，请确保飞书连接器已配置');
  }

  const connectorConfig = configStoreInstance.getConnectorConfig('feishu');
  if (!connectorConfig?.config?.appId || !connectorConfig?.config?.appSecret) {
    throw new Error('飞书连接器未配置，请先在系统设置中配置飞书连接器的 appId 和 appSecret');
  }

  const clientKey = `${connectorConfig.config.appId}:${connectorConfig.config.appSecret}`;
  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  const lark = require('@larksuiteoapi/node-sdk');
  cachedClient = new lark.Client({
    appId: connectorConfig.config.appId,
    appSecret: connectorConfig.config.appSecret,
    disableTokenCache: false,
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

/**
 * 加载卡片模板
 */
function loadCardTemplate(templateName: string): Record<string, any> {
  const templatePath = path.join(__dirname, 'feishu-card-templates', `${templateName}.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`卡片模板不存在: ${templateName}`);
  }
  return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
}

/**
 * 渲染卡片模板（简单变量替换）
 */
function renderCardTemplate(template: Record<string, any>, variables: Record<string, any>): Record<string, any> {
  let jsonStr = JSON.stringify(template);
  for (const [key, value] of Object.entries(variables)) {
    jsonStr = jsonStr.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  return JSON.parse(jsonStr);
}

/** 统一错误返回 */
function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

// ==================== 工具插件 ====================

export const feishuCardToolPlugin: ToolPlugin = {
  metadata: {
    id: 'feishu-card',
    name: '飞书消息卡片',
    description: '发送和更新飞书交互卡片，支持经营数据推送、预警通知等场景',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['feishu', 'card', 'notification'],
  },

  create(options: ToolCreateOptions) {
    if (options.configStore) {
      setConfigStoreForFeishuCardTool(options.configStore);
    }

    // ========== 发送卡片 ==========
    const sendCardTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_SEND_CARD,
      label: '发送飞书卡片',
      description: '向飞书群组或用户发送交互式消息卡片。支持使用模板或自定义卡片内容。用于推送每日经营数据、预警通知等。',
      parameters: Type.Object({
        receive_id: Type.String({
          description: '接收者 ID（群组 chat_id 或用户 open_id）',
        }),
        receive_id_type: Type.Optional(
          Type.Union(
            [Type.Literal('chat_id'), Type.Literal('open_id')],
            { description: '接收者 ID 类型，默认 chat_id', default: 'chat_id' }
          )
        ),
        template_name: Type.Optional(
          Type.String({
            description: '卡片模板名称（如 daily_report, warning），与 card_content 二选一',
          })
        ),
        template_variables: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '模板变量，如 {"storeName": "趣东北", "revenue": "3580"}',
          })
        ),
        card_content: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '自定义卡片 JSON 内容（飞书卡片格式），与 template_name 二选一',
          })
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { receive_id, receive_id_type = 'chat_id', template_name, template_variables, card_content } = args;

        try {
          // 确定卡片内容
          let finalCardContent: Record<string, any>;

          if (template_name && template_variables) {
            // 使用模板
            const template = loadCardTemplate(template_name);
            finalCardContent = renderCardTemplate(template, template_variables);
          } else if (card_content) {
            // 使用自定义内容
            finalCardContent = card_content;
          } else {
            return errResult('参数错误', new Error('请提供 template_name + template_variables 或 card_content'));
          }

          const client = await getLarkClient();

          // 发送卡片消息
          const response = await client.im.message.create({
            params: { receive_id_type },
            data: {
              receive_id,
              msg_type: 'interactive',
              content: JSON.stringify(finalCardContent),
            },
          });

          const messageId = (response as any)?.data?.message_id;

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 卡片发送成功\n消息 ID: ${messageId}\n接收者: ${receive_id}`,
            }],
            details: {
              success: true,
              messageId,
              receiveId: receive_id,
            },
          };
        } catch (error) {
          logger.error('发送卡片失败:', error);
          return errResult('发送卡片失败', error);
        }
      },
    };

    // ========== 更新卡片 ==========
    const updateCardTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_UPDATE_CARD,
      label: '更新飞书卡片',
      description: '更新已发送的飞书交互卡片内容。用于刷新经营数据卡片、更新预警状态等。',
      parameters: Type.Object({
        message_id: Type.String({
          description: '要更新的消息 ID（发送卡片时返回的 messageId）',
        }),
        template_name: Type.Optional(
          Type.String({
            description: '卡片模板名称',
          })
        ),
        template_variables: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '模板变量',
          })
        ),
        card_content: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '自定义卡片 JSON 内容',
          })
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { message_id, template_name, template_variables, card_content } = args;

        try {
          let finalCardContent: Record<string, any>;

          if (template_name && template_variables) {
            const template = loadCardTemplate(template_name);
            finalCardContent = renderCardTemplate(template, template_variables);
          } else if (card_content) {
            finalCardContent = card_content;
          } else {
            return errResult('参数错误', new Error('请提供 template_name + template_variables 或 card_content'));
          }

          const client = await getLarkClient();

          // 更新卡片消息
          await client.im.message.patch({
            path: { message_id },
            data: {
              content: JSON.stringify(finalCardContent),
            },
          });

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 卡片更新成功\n消息 ID: ${message_id}`,
            }],
            details: { success: true, messageId: message_id },
          };
        } catch (error) {
          logger.error('更新卡片失败:', error);
          return errResult('更新卡片失败', error);
        }
      },
    };

    // ========== 批量发送卡片 ==========
    const batchSendCardTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_BATCH_SEND_CARD,
      label: '批量发送飞书卡片',
      description: '批量向多个接收者发送卡片。用于向多个门店群同时推送经营数据。支持并发控制。',
      parameters: Type.Object({
        targets: Type.Array(
          Type.Object({
            receive_id: Type.String({ description: '接收者 ID' }),
            receive_id_type: Type.Optional(
              Type.Union([Type.Literal('chat_id'), Type.Literal('open_id')])
            ),
            variables: Type.Optional(
              Type.Record(Type.String(), Type.Any(), {
                description: '该接收者的模板变量（覆盖全局变量）',
              })
            ),
          }),
          { description: '接收者列表' }
        ),
        template_name: Type.String({
          description: '卡片模板名称',
        }),
        global_variables: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '全局模板变量（可被 targets 中的 variables 覆盖）',
          })
        ),
        concurrency: Type.Optional(
          Type.Number({
            description: '并发发送数量，默认 5',
            default: 5,
          })
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { targets, template_name, global_variables = {}, concurrency = 5 } = args;

        try {
          const template = loadCardTemplate(template_name);
          const client = await getLarkClient();

          const results: Array<{ receive_id: string; success: boolean; messageId?: string; error?: string }> = [];

          // 分批并发发送
          for (let i = 0; i < targets.length; i += concurrency) {
            const batch = targets.slice(i, i + concurrency);
            const promises = batch.map(async (target: any) => {
              const mergedVars = { ...global_variables, ...target.variables };
              const cardContent = renderCardTemplate(template, mergedVars);
              const receiveIdType = target.receive_id_type || 'chat_id';

              try {
                const response = await client.im.message.create({
                  params: { receive_id_type: receiveIdType },
                  data: {
                    receive_id: target.receive_id,
                    msg_type: 'interactive',
                    content: JSON.stringify(cardContent),
                  },
                });

                const messageId = (response as any)?.data?.message_id;
                results.push({ receive_id: target.receive_id, success: true, messageId });
              } catch (error) {
                results.push({
                  receive_id: target.receive_id,
                  success: false,
                  error: getErrorMessage(error),
                });
              }
            });

            await Promise.allSettled(promises);
          }

          const successCount = results.filter(r => r.success).length;
          const failCount = results.filter(r => !r.success).length;

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 批量发送完成\n成功: ${successCount}\n失败: ${failCount}\n总数: ${targets.length}`,
            }],
            details: {
              success: true,
              total: targets.length,
              successCount,
              failCount,
              results,
            },
          };
        } catch (error) {
          logger.error('批量发送卡片失败:', error);
          return errResult('批量发送卡片失败', error);
        }
      },
    };

    return [sendCardTool, updateCardTool, batchSendCardTool];
  },
};
