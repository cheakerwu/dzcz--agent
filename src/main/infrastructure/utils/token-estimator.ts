/**
 * Token 估算工具
 * 
 * 提供简单高效的 token 估算功能
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { getContextWindowFromModelId } from './model-info-fetcher';

/**
 * Token 估算常量
 */
const IMAGE_TOKEN_ESTIMATE = 2000;   // 图片约 2000 tokens
const DEFAULT_CONTEXT_WINDOW = 32000; // 默认上下文窗口（32K）

/**
 * 估算文本的 token 数量（区分中英文）
 * 
 * 中文/日文/韩文字符平均 1.5 token/字符
 * 英文/数字/符号平均 0.25 token/字符（4 字符 = 1 token）
 * 
 * @param text - 文本内容
 * @returns 估算的 token 数量
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  
  // 用正则统计 CJK 字符数量（比逐字符遍历更快）
  const cjkMatches = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF\uFF00-\uFFEF]/g);
  const cjkChars = cjkMatches ? cjkMatches.length : 0;
  const otherChars = text.length - cjkChars;
  
  // 中文 1.5 token/字符，英文 0.25 token/字符
  return Math.ceil(cjkChars * 1.5 + otherChars / 4);
}

/**
 * 估算单条消息的 token 数量
 * 
 * @param message - Agent 消息
 * @returns 估算的 token 数量
 */
export function estimateTokens(message: AgentMessage): number {
  if (!message) return 0;

  // User 消息
  if (message.role === 'user') {
    const content = message.content;
    
    // 字符串内容
    if (typeof content === 'string') {
      return estimateTextTokens(content);
    }
    
    // 数组内容（文本 + 图片）
    if (Array.isArray(content)) {
      let tokens = 0;
      for (const block of content) {
        if (block.type === 'text') {
          tokens += estimateTextTokens(block.text);
        } else if (block.type === 'image') {
          tokens += IMAGE_TOKEN_ESTIMATE;
        }
      }
      return tokens;
    }
    
    return 0;
  }

  // Assistant 消息
  if (message.role === 'assistant') {
    let tokens = 0;
    
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          tokens += estimateTextTokens(block.text);
        } else if (block.type === 'thinking') {
          tokens += estimateTextTokens(block.thinking);
        } else if (block.type === 'toolCall') {
          // 工具调用：估算参数 JSON 的大小
          try {
            const argsStr = JSON.stringify(block.arguments ?? {});
            tokens += estimateTextTokens(argsStr);
          } catch {
            tokens += 32; // 默认 32 tokens
          }
        }
      }
    }
    
    return tokens;
  }

  // Tool Result 消息
  if (message.role === 'toolResult') {
    let tokens = 0;
    
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          tokens += estimateTextTokens(block.text);
        } else if (block.type === 'image') {
          tokens += IMAGE_TOKEN_ESTIMATE;
        }
      }
    }
    
    return tokens;
  }

  // 其他类型消息（system 等）
  return 64; // 默认 64 tokens
}

/**
 * 估算消息数组的总 token 数量
 * 
 * @param messages - 消息数组
 * @returns 总 token 数量
 */
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  if (!messages || messages.length === 0) return 0;
  
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

/**
 * 获取模型的上下文窗口大小
 * 
 * 优先级：
 * 1. 数据库中保存的值（用户配置的模型）
 * 2. 写死的配置表
 * 3. 模糊匹配
 * 4. 默认值
 * 
 * @param modelId - 模型 ID
 * @returns 上下文窗口大小（token 数量）
 */
export function getContextWindowTokens(modelId?: string): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  
  // 1. 优先从数据库读取（用户配置的模型）
  try {
    const { SystemConfigStore } = require('../database/system-config-store');
    const store = SystemConfigStore.getInstance();
    const modelConfig = store.getModelConfig();
    
    if (modelConfig && modelConfig.modelId === modelId && modelConfig.contextWindow) {
      console.debug(`[Token Estimator] 使用数据库中的上下文窗口: ${modelConfig.contextWindow}`);
      return modelConfig.contextWindow;
    }
  } catch (error) {
    console.warn('[Token Estimator] 从数据库读取上下文窗口失败:', error);
  }
  
  // 2. 使用模糊匹配推断
  return getContextWindowFromModelId(modelId);
}

/**
 * 计算上下文使用率
 * 
 * @param messages - 消息数组
 * @param modelId - 模型 ID
 * @returns 使用率（0-1 之间的小数）
 */
export function calculateContextUsage(messages: AgentMessage[], modelId?: string): number {
  const totalTokens = estimateMessagesTokens(messages);
  const contextWindow = getContextWindowTokens(modelId);
  
  return totalTokens / contextWindow;
}

/**
 * 检查上下文是否接近限制
 * 
 * @param messages - 消息数组
 * @param modelId - 模型 ID
 * @param threshold - 阈值（默认 0.7，即 70%）
 * @returns 是否接近限制
 */
export function isContextNearLimit(
  messages: AgentMessage[],
  modelId?: string,
  threshold: number = 0.7
): boolean {
  const usage = calculateContextUsage(messages, modelId);
  return usage >= threshold;
}

/**
 * 获取上下文统计信息
 * 
 * @param messages - 消息数组
 * @param modelId - 模型 ID
 * @returns 统计信息
 */
export function getContextStats(messages: AgentMessage[], modelId?: string) {
  const totalTokens = estimateMessagesTokens(messages);
  const contextWindow = getContextWindowTokens(modelId);
  const usageRatio = totalTokens / contextWindow;
  const remainingTokens = Math.max(0, contextWindow - totalTokens);
  
  return {
    totalTokens,
    contextWindow,
    usageRatio,
    usagePercent: Math.round(usageRatio * 100),
    remainingTokens,
    messageCount: messages.length,
  };
}
