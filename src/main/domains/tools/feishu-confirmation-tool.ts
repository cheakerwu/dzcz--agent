import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolCreateOptions, ToolPlugin } from './registry/tool-interface';
import { TOOL_NAMES } from './tool-names';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { createLogger } from '../../../shared/utils/logger';
import {
  buildFeishuConfirmationCard,
  createConfirmationPlanId,
  globalFeishuConfirmationStore,
  type FeishuConfirmationRiskLevel,
  type FeishuConfirmationStore,
} from '../connectors/feishu/confirmation-card';
import { getGatewayInstance } from '../../infrastructure/gateway/gateway';

const logger = createLogger('FeishuConfirmationTool');

let configStoreInstance: any = null;

export function setConfigStoreForFeishuConfirmationTool(store: any): void {
  configStoreInstance = store;
}

function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

async function sendInteractiveCardWithGateway(input: {
  conversationId: string;
  card: Record<string, any>;
  replyToMessageId?: string;
}): Promise<{ messageId?: string }> {
  const gateway = getGatewayInstance();
  const connectorManager = gateway?.getConnectorManager();
  if (!connectorManager?.sendInteractiveCard) {
    throw new Error('飞书连接器尚未准备好，无法发送确认卡片');
  }

  return await connectorManager.sendInteractiveCard(
    'feishu',
    input.conversationId,
    input.card,
    input.replyToMessageId,
  );
}

export const feishuConfirmationToolPlugin: ToolPlugin = {
  metadata: {
    id: 'feishu-confirmation',
    name: '飞书操作确认',
    description: '发送高风险操作确认卡片，并记录等待确认的计划。',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['feishu', 'card', 'confirmation', 'risk-control'],
  },

  create(options: ToolCreateOptions) {
    if (options.configStore) {
      setConfigStoreForFeishuConfirmationTool(options.configStore);
    }

    const confirmationStore: FeishuConfirmationStore =
      options.dependencies?.confirmationStore || globalFeishuConfirmationStore;
    const sendInteractiveCard =
      options.dependencies?.sendInteractiveCard || sendInteractiveCardWithGateway;

    const tool: AgentTool = {
      name: TOOL_NAMES.FEISHU_CONFIRMATION,
      label: '发送飞书操作确认',
      description: `为高风险或中风险操作发送飞书确认卡片。适用于改价、改营业时间、改电话、发布活动、替换图片、删除或批量操作等写入动作。必须把 planId 视为本次操作计划的唯一确认编号；用户点击确认前，不要执行真实写入。若上游工具返回 requiredConfirmationBinding，必须原样传入 execution_binding，防止确认编号被复用到不同操作。`,
      parameters: Type.Object({
        receive_id: Type.String({
          description: '接收确认卡片的飞书会话 ID，通常是当前群 chat_id 或当前用户 open_id',
        }),
        title: Type.String({
          description: '确认卡片标题，例如“价格调整确认”',
        }),
        summary: Type.String({
          description: '一句话说明将要执行的操作',
        }),
        risk_level: Type.Union([
          Type.Literal('low'),
          Type.Literal('medium'),
          Type.Literal('high'),
          Type.Literal('critical'),
        ], {
          description: '风险等级。高风险/敏感操作必须确认后再执行。',
        }),
        requester_id: Type.Optional(Type.String({ description: '发起人飞书 open_id/user_id' })),
        requester_name: Type.Optional(Type.String({ description: '发起人姓名' })),
        details: Type.Optional(Type.Record(Type.String(), Type.Any(), {
          description: '操作详情，会展示在确认卡片中',
        })),
        execution_binding: Type.Optional(Type.Object({
          toolName: Type.String({
            description: '本次确认绑定的工具名，例如 browser_act',
          }),
          signature: Type.String({
            description: '本次确认绑定的执行签名，由需要确认的工具返回',
          }),
          summary: Type.Optional(Type.String({
            description: '本次确认绑定的执行摘要，便于审计',
          })),
        }, {
          description: '可选：把确认卡绑定到具体工具调用。高风险 BrowserAct 写入动作必须使用 browser_act 返回的 requiredConfirmationBinding。',
        })),
        plan_id: Type.Optional(Type.String({
          description: '可选确认编号；不传时系统自动生成',
        })),
        reply_to_message_id: Type.Optional(Type.String({
          description: '可选：要回复的原始飞书消息 ID',
        })),
      }),

      execute: async (_toolCallId: string, args: any) => {
        try {
          const planId = args.plan_id || createConfirmationPlanId('confirm_plan');
          const riskLevel = args.risk_level as FeishuConfirmationRiskLevel;
          const card = buildFeishuConfirmationCard({
            planId,
            title: args.title,
            summary: args.summary,
            riskLevel,
            requesterId: args.requester_id,
            requesterName: args.requester_name,
            conversationId: args.receive_id,
            details: args.details || {},
            executionBinding: args.execution_binding,
          });

          const sent = await sendInteractiveCard({
            conversationId: args.receive_id,
            card,
            replyToMessageId: args.reply_to_message_id,
          });

          const plan = confirmationStore.create({
            planId,
            title: args.title,
            summary: args.summary,
            riskLevel,
            requesterId: args.requester_id,
            requesterName: args.requester_name,
            conversationId: args.receive_id,
            messageId: sent?.messageId,
            details: args.details || {},
            executionBinding: args.execution_binding,
          });

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 已发送飞书确认卡片\n确认编号: ${plan.planId}\n状态: 等待确认\n\n在用户点击确认前，请不要执行真实写入。`,
            }],
            details: {
              success: true,
              planId: plan.planId,
              status: plan.status,
              messageId: sent?.messageId,
              riskLevel,
              executionBinding: plan.executionBinding,
            },
          };
        } catch (error) {
          logger.error('发送飞书确认卡片失败:', error);
          return errResult('发送飞书确认卡片失败', error);
        }
      },
    };

    return tool;
  },
};
