/**
 * 飞书卡片回调处理器
 *
 * 处理飞书交互卡片中的按钮点击事件，包括：
 * - 查看详细数据
 * - 重新采集
 * - 标记已处理
 * - 忽略预警
 *
 * 依赖飞书连接器的事件监听机制
 */

import type { Gateway } from '../../infrastructure/gateway/gateway';
import { createLogger } from '../../../shared/utils/logger';
import { getErrorMessage } from '../../../shared/utils/error-handler';

const logger = createLogger('FeishuCardCallback');

// 全局 Gateway 引用
let gatewayInstance: Gateway | null = null;

/**
 * 注入 Gateway 实例（由 gateway.ts 调用）
 */
export function setGatewayForCardCallback(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 卡片按钮回调数据
 */
export interface CardCallbackData {
  /** 操作类型 */
  action: string;
  /** 门店 ID */
  store_id?: string;
  /** 预警 ID */
  warning_id?: string;
  /** 其他自定义数据 */
  [key: string]: any;
}

/**
 * 卡片回调上下文
 */
export interface CardCallbackContext {
  /** 操作者 open_id */
  operatorId: string;
  /** 操作者名称 */
  operatorName?: string;
  /** 消息 ID */
  messageId: string;
  /** 会话 ID */
  chatId?: string;
}

/**
 * 处理卡片按钮回调
 *
 * @param callbackData 按钮携带的数据
 * @param callbackContext 回调上下文信息
 * @returns 处理结果（用于更新卡片或回复消息）
 */
export async function handleCardCallback(
  callbackData: CardCallbackData,
  callbackContext: CardCallbackContext
): Promise<{ updateCard?: Record<string, any>; replyMessage?: string }> {
  const { action, store_id, warning_id } = callbackData;
  const { operatorId, operatorName, messageId, chatId } = callbackContext;

  logger.info(`收到卡片回调: action=${action}, operator=${operatorName}, store=${store_id}`);

  try {
    switch (action) {
      case 'feishu_task_progress_status':
      case 'feishu_task_progress_stop': {
        if (!gatewayInstance) {
          return { replyMessage: '系统还没有准备好处理任务卡片，请稍后再试。' };
        }

        const tabId = callbackData.tab_id || callbackData.tabId;
        const replyMessage = await gatewayInstance.handleFeishuProgressCardAction(action, tabId);
        return { replyMessage };
      }

      case 'feishu_confirmation_approve':
      case 'feishu_confirmation_reject': {
        if (!gatewayInstance) {
          return { replyMessage: '系统还没有准备好处理确认卡片，请稍后再试。' };
        }

        const planId = callbackData.plan_id || callbackData.planId;
        const replyMessage = await gatewayInstance.handleFeishuConfirmationAction(action, planId, {
          operatorId,
          operatorName,
        });
        return { replyMessage };
      }

      case 'view_detail': {
        // 查看详细数据 - 触发 Agent 生成详细报告
        if (store_id && gatewayInstance) {
          // 在对应的 Tab 中发送消息给 Agent
          const tabName = `门店_${store_id}`;
          return {
            replyMessage: `正在为您生成 ${store_id} 的详细经营数据报告...`,
          };
        }
        return {
          replyMessage: `正在生成详细报告...`,
        };
      }

      case 'recollect': {
        // 重新采集 - 触发执行 Agent 进行数据采集
        if (store_id) {
          logger.info(`触发重新采集: store=${store_id}, operator=${operatorName}`);
          return {
            replyMessage: `已发起重新采集请求，门店 ${store_id} 的数据将在稍后更新。`,
          };
        }
        return {
          replyMessage: `已发起重新采集请求。`,
        };
      }

      case 'mark_handled': {
        // 标记已处理 - 更新预警状态
        if (warning_id) {
          logger.info(`预警已标记处理: warning=${warning_id}, operator=${operatorName}`);
          return {
            updateCard: {
              header: {
                title: { tag: 'plain_text', content: '✅ 预警已处理' },
                template: 'green',
              },
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**处理人：** ${operatorName || operatorId}\n**处理时间：** ${new Date().toLocaleString('zh-CN')}`,
                  },
                },
              ],
            },
            replyMessage: `已标记预警 ${warning_id} 为已处理。`,
          };
        }
        return { replyMessage: `已标记为已处理。` };
      }

      case 'view_warning_detail': {
        // 查看预警详情
        if (warning_id) {
          return {
            replyMessage: `正在为您生成预警 ${warning_id} 的详细分析...`,
          };
        }
        return { replyMessage: `正在生成预警详情...` };
      }

      case 'ignore_warning': {
        // 忽略预警
        if (warning_id) {
          logger.info(`预警已忽略: warning=${warning_id}, operator=${operatorName}`);
          return {
            updateCard: {
              header: {
                title: { tag: 'plain_text', content: '🔕 预警已忽略' },
                template: 'grey',
              },
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**忽略人：** ${operatorName || operatorId}\n**忽略时间：** ${new Date().toLocaleString('zh-CN')}`,
                  },
                },
              ],
            },
            replyMessage: `已忽略预警 ${warning_id}。`,
          };
        }
        return { replyMessage: `已忽略预警。` };
      }

      default:
        logger.warn(`未知的卡片回调动作: ${action}`);
        return {
          replyMessage: `未知操作: ${action}`,
        };
    }
  } catch (error) {
    logger.error('处理卡片回调失败:', error);
    return {
      replyMessage: `❌ 处理失败: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * 注册卡片回调事件监听
 *
 * 在飞书连接器初始化时调用，将卡片回调处理逻辑
 * 注册到飞书的事件分发器中
 *
 * 注意：飞书卡片回调需要配置请求网址（HTTP POST），
 * 或使用 WebSocket 模式接收事件。
 * 当前版本使用 WebSocket 模式，与消息接收共用连接。
 */
export function registerCardCallbackHandler(eventDispatcher: any): void {
  // 注册卡片回调事件
  // 注意：飞书 SDK 的卡片回调事件名为 'card.action.trigger'
  eventDispatcher.register({
    'card.action.trigger': async (data: any) => {
      try {
        const action = data?.action;
        const operator = data?.operator;
        const messageId = data?.context?.message_id;
        const chatId = data?.context?.chat_id;

        if (!action?.value) {
          logger.warn('卡片回调缺少 action.value');
          return { code: 0 };
        }

        const callbackData: CardCallbackData = action.value;
        const callbackContext: CardCallbackContext = {
          operatorId: operator?.open_id || '',
          operatorName: operator?.name,
          messageId: messageId || '',
          chatId,
        };

        const result = await handleCardCallback(callbackData, callbackContext);

        // 如果需要更新卡片，返回更新后的内容
        if (result.updateCard) {
          return {
            code: 0,
            data: {
              toast: {
                type: 'success',
                content: result.replyMessage || '操作成功',
              },
            },
          };
        }

        // 返回 toast 提示
        return {
          code: 0,
          data: {
            toast: {
              type: 'info',
              content: result.replyMessage || '操作成功',
            },
          },
        };
      } catch (error) {
        logger.error('卡片回调处理异常:', error);
        return {
          code: 0,
          data: {
            toast: {
              type: 'error',
              content: `处理失败: ${getErrorMessage(error)}`,
            },
          },
        };
      }
    },
  });

  logger.info('卡片回调事件处理器已注册');
}
