/**
 * 工具结果裁剪器
 * 
 * 自动裁剪冗长的工具调用结果，节省上下文空间
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { estimateTokens, getContextWindowTokens } from '../utils/token-estimator';

/**
 * 裁剪配置
 */
export interface PruningSettings {
  softTrimRatio: number;      // 开始 Soft Trim 的阈值（默认 0.7）
  hardClearRatio: number;     // 开始 Hard Clear 的阈值（默认 0.85）
  headChars: number;          // Soft Trim 保留的头部字符数
  tailChars: number;          // Soft Trim 保留的尾部字符数
  placeholder: string;        // Hard Clear 的占位符
  keepLastAssistants: number; // 保护最后 N 个 assistant 消息
  minPrunableChars: number;   // 最小可裁剪字符数
}

/**
 * 默认裁剪配置
 */
export const DEFAULT_PRUNING_SETTINGS: PruningSettings = {
  softTrimRatio: 0.7,
  hardClearRatio: 0.85,
  headChars: 500,
  tailChars: 500,
  placeholder: '[工具结果已清除以节省上下文空间]',
  keepLastAssistants: 1, // 减少到只保护最后 1 个 assistant 消息
  minPrunableChars: 1000, // 降低最小裁剪阈值
};

/**
 * 文本内容块
 */
interface TextContent {
  type: 'text';
  text: string;
}

/**
 * 图片内容块
 */
interface ImageContent {
  type: 'image';
  source: unknown;
}

/**
 * 工具结果消息
 */
interface ToolResultMessage {
  role: 'toolResult';
  toolName: string;
  content: Array<TextContent | ImageContent>;
  toolCallId?: string;
  isError?: boolean;
  timestamp?: number;
}

/**
 * 收集文本片段
 */
function collectTextSegments(content: Array<TextContent | ImageContent>): string[] {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts;
}

/**
 * 估算拼接后的文本长度
 */
function estimateJoinedTextLength(parts: string[]): number {
  if (parts.length === 0) return 0;
  
  let len = 0;
  for (const p of parts) {
    len += p.length;
  }
  
  // 加上换行符的长度
  len += Math.max(0, parts.length - 1);
  
  return len;
}

/**
 * 从拼接文本中提取头部
 */
function takeHeadFromJoinedText(parts: string[], maxChars: number): string {
  if (maxChars <= 0 || parts.length === 0) return '';
  
  let remaining = maxChars;
  let out = '';
  
  for (let i = 0; i < parts.length && remaining > 0; i++) {
    if (i > 0) {
      out += '\n';
      remaining -= 1;
      if (remaining <= 0) break;
    }
    
    const p = parts[i];
    if (p.length <= remaining) {
      out += p;
      remaining -= p.length;
    } else {
      out += p.slice(0, remaining);
      remaining = 0;
    }
  }
  
  return out;
}

/**
 * 从拼接文本中提取尾部
 */
function takeTailFromJoinedText(parts: string[], maxChars: number): string {
  if (maxChars <= 0 || parts.length === 0) return '';
  
  let remaining = maxChars;
  const out: string[] = [];
  
  for (let i = parts.length - 1; i >= 0 && remaining > 0; i--) {
    const p = parts[i];
    
    if (p.length <= remaining) {
      out.push(p);
      remaining -= p.length;
    } else {
      out.push(p.slice(p.length - remaining));
      remaining = 0;
      break;
    }
    
    if (remaining > 0 && i > 0) {
      out.push('\n');
      remaining -= 1;
    }
  }
  
  out.reverse();
  return out.join('');
}

/**
 * 检查内容是否包含图片
 */
function hasImageBlocks(content: Array<TextContent | ImageContent>): boolean {
  for (const block of content) {
    if (block.type === 'image') return true;
  }
  return false;
}

/**
 * 查找最后 N 个 assistant 消息的截止索引
 */
function findAssistantCutoffIndex(
  messages: AgentMessage[],
  keepLastAssistants: number
): number | null {
  if (keepLastAssistants <= 0) return messages.length;

  let remaining = keepLastAssistants;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'assistant') continue;
    remaining--;
    if (remaining === 0) return i;
  }

  return null; // 没有足够的 assistant 消息
}

/**
 * 查找第一个 user 消息的索引
 */
function findFirstUserIndex(messages: AgentMessage[]): number | null {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') return i;
  }
  return null;
}

/**
 * Soft Trim：保留头尾，中间用省略号替代
 */
function softTrimToolResult(
  msg: ToolResultMessage,
  settings: PruningSettings
): ToolResultMessage | null {
  // 跳过包含图片的工具结果
  if (hasImageBlocks(msg.content)) return null;

  const parts = collectTextSegments(msg.content);
  const rawLen = estimateJoinedTextLength(parts);
  
  // 如果长度不超过限制，不裁剪
  if (rawLen <= settings.minPrunableChars) return null;

  const headChars = Math.max(0, settings.headChars);
  const tailChars = Math.max(0, settings.tailChars);
  
  // 如果头尾加起来已经超过原长度，不裁剪
  if (headChars + tailChars >= rawLen) return null;

  const head = takeHeadFromJoinedText(parts, headChars);
  const tail = takeTailFromJoinedText(parts, tailChars);
  
  const trimmed = `${head}\n...\n${tail}`;
  const note = `\n\n[工具结果已裁剪: 保留前 ${headChars} 字符和后 ${tailChars} 字符，共 ${rawLen} 字符]`;

  return {
    ...msg,
    content: [{ type: 'text', text: trimmed + note }],
  };
}

/**
 * Hard Clear：完全替换为占位符
 */
function hardClearToolResult(
  msg: ToolResultMessage,
  settings: PruningSettings
): ToolResultMessage {
  return {
    ...msg,
    content: [{ type: 'text', text: settings.placeholder }],
  };
}

/**
 * 裁剪工具结果
 * 
 * @param messages - 消息数组
 * @param settings - 裁剪配置
 * @param modelId - 模型 ID
 * @param fixedOverheadTokens - 固定开销 token 数（系统提示词 + 工具定义）
 * @returns 裁剪后的消息数组和统计信息
 */
export function pruneToolResults(
  messages: AgentMessage[],
  settings: PruningSettings = DEFAULT_PRUNING_SETTINGS,
  modelId?: string,
  fixedOverheadTokens: number = 0
): {
  messages: AgentMessage[];
  stats: {
    totalMessages: number;
    softTrimmed: number;
    hardCleared: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
  };
} {
  const contextWindow = getContextWindowTokens(modelId);

  // 计算初始 token 数（包含固定开销）
  const messagesTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const tokensBefore = messagesTokens;
  const totalTokensBefore = fixedOverheadTokens + messagesTokens;
  const ratio = totalTokensBefore / contextWindow;

  console.debug(`[Tool Result Pruner] Token 分析:`);
  console.debug(`  - 上下文窗口: ${contextWindow} tokens`);
  console.debug(`  - 固定开销: ${fixedOverheadTokens} tokens`);
  console.debug(`  - 消息部分: ${messagesTokens} tokens`);
  console.debug(`  - 总计: ${totalTokensBefore} tokens`);
  console.debug(`  - 使用率: ${(ratio * 100).toFixed(1)}%`);
  console.debug(`  - Soft Trim 阈值: ${(settings.softTrimRatio * 100).toFixed(1)}%`);

  // 如果使用率 < softTrimRatio，不裁剪
  if (ratio < settings.softTrimRatio) {
    console.debug(`[Tool Result Pruner] 使用率未达到修剪阈值，跳过修剪`);
    return {
      messages,
      stats: {
        totalMessages: messages.length,
        softTrimmed: 0,
        hardCleared: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
        tokensSaved: 0,
      },
    };
  }

  // 找到保护区域
  const cutoffIndex = findAssistantCutoffIndex(messages, settings.keepLastAssistants);
  const firstUserIndex = findFirstUserIndex(messages);
  const pruneStartIndex = firstUserIndex === null ? messages.length : firstUserIndex;

  console.debug(`[Tool Result Pruner] 保护区域分析:`);
  console.debug(`  - 总消息数: ${messages.length}`);
  console.debug(`  - 保护最后 ${settings.keepLastAssistants} 个 assistant 消息`);
  console.debug(`  - cutoffIndex: ${cutoffIndex}`);
  console.debug(`  - firstUserIndex: ${firstUserIndex}`);
  console.debug(`  - pruneStartIndex: ${pruneStartIndex}`);
  
  // 调试：打印消息结构
  console.debug(`[Tool Result Pruner] 消息结构分析:`);
  for (let i = 0; i < Math.min(messages.length, 10); i++) {
    const msg = messages[i];
    const role = msg?.role || 'unknown';
    const isToolResult = role === 'toolResult';
    const toolName = isToolResult ? (msg as any).toolName : '';
    console.debug(`  [${i}] ${role}${toolName ? ` (${toolName})` : ''}`);
  }
  if (messages.length > 10) {
    console.debug(`  ... (${messages.length - 10} 条消息省略)`);
  }

  // 如果没有可裁剪的区域
  if (cutoffIndex === null || pruneStartIndex >= cutoffIndex) {
    console.debug(`[Tool Result Pruner] 没有可裁剪区域，跳过修剪`);
    return {
      messages,
      stats: {
        totalMessages: messages.length,
        softTrimmed: 0,
        hardCleared: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
        tokensSaved: 0,
      },
    };
  }

  let softTrimmed = 0;
  let hardCleared = 0;
  let next: AgentMessage[] | null = null;
  const prunableIndexes: number[] = [];

  console.debug(`[Tool Result Pruner] 开始扫描可修剪的工具结果 (${pruneStartIndex} → ${cutoffIndex})`);

  // 第一阶段：Soft Trim
  for (let i = pruneStartIndex; i < cutoffIndex; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'toolResult') continue;
    
    const toolMsg = msg as ToolResultMessage;
    console.debug(`[Tool Result Pruner] 发现工具结果 [${i}]: ${toolMsg.toolName}`);
    
    if (hasImageBlocks(toolMsg.content)) {
      console.debug(`[Tool Result Pruner] 跳过包含图片的工具结果 [${i}]`);
      continue;
    }
    
    const parts = collectTextSegments(toolMsg.content);
    const rawLen = estimateJoinedTextLength(parts);
    console.debug(`[Tool Result Pruner] 工具结果 [${i}] 长度: ${rawLen} 字符`);
    
    prunableIndexes.push(i);

    const updated = softTrimToolResult(toolMsg, settings);
    if (!updated) {
      console.debug(`[Tool Result Pruner] 工具结果 [${i}] 太短，跳过修剪`);
      continue;
    }

    const beforeTokens = estimateTokens(msg);
    const afterTokens = estimateTokens(updated as AgentMessage);
    
    if (!next) next = messages.slice();
    next[i] = updated as AgentMessage;
    softTrimmed++;
    
    console.debug(`[Tool Result Pruner] Soft Trim [${i}]: ${beforeTokens} → ${afterTokens} tokens`);
  }

  console.debug(`[Tool Result Pruner] Soft Trim 完成: ${softTrimmed} 个工具结果被修剪`);

  const outputAfterSoftTrim = next ?? messages;
  const messagesTokensAfterSoftTrim = outputAfterSoftTrim.reduce((sum, m) => sum + estimateTokens(m), 0);
  const totalTokensAfterSoftTrim = fixedOverheadTokens + messagesTokensAfterSoftTrim;
  const ratioAfterSoftTrim = totalTokensAfterSoftTrim / contextWindow;

  console.debug(`[Tool Result Pruner] Soft Trim 后使用率: ${(ratioAfterSoftTrim * 100).toFixed(1)}%`);

  // 如果使用率 < hardClearRatio，停止
  if (ratioAfterSoftTrim < settings.hardClearRatio) {
    return {
      messages: outputAfterSoftTrim,
      stats: {
        totalMessages: messages.length,
        softTrimmed,
        hardCleared: 0,
        tokensBefore,
        tokensAfter: messagesTokensAfterSoftTrim,
        tokensSaved: tokensBefore - messagesTokensAfterSoftTrim,
      },
    };
  }

  // 第二阶段：Hard Clear
  console.debug(`[Tool Result Pruner] 开始 Hard Clear 阶段`);
  
  for (const i of prunableIndexes) {
    const currentTokens = fixedOverheadTokens + (next ?? messages).reduce((sum, m) => sum + estimateTokens(m), 0);
    const currentRatio = currentTokens / contextWindow;
    
    if (currentRatio < settings.hardClearRatio) {
      console.debug(`[Tool Result Pruner] 使用率已降至 ${(currentRatio * 100).toFixed(1)}%，停止 Hard Clear`);
      break;
    }
    
    const msg = (next ?? messages)[i];
    if (!msg || msg.role !== 'toolResult') continue;

    const beforeTokens = estimateTokens(msg);
    const cleared = hardClearToolResult(msg as ToolResultMessage, settings);
    
    if (!next) next = messages.slice();
    next[i] = cleared as AgentMessage;
    
    const afterTokens = estimateTokens(cleared as AgentMessage);
    hardCleared++;
    
    console.debug(`[Tool Result Pruner] Hard Clear [${i}]: ${beforeTokens} → ${afterTokens} tokens`);
  }

  console.debug(`[Tool Result Pruner] Hard Clear 完成: ${hardCleared} 个工具结果被清除`);

  const finalMessages = next ?? messages;
  const finalMessagesTokens = finalMessages.reduce((sum, m) => sum + estimateTokens(m), 0);

  return {
    messages: finalMessages,
    stats: {
      totalMessages: messages.length,
      softTrimmed,
      hardCleared,
      tokensBefore,
      tokensAfter: finalMessagesTokens,
      tokensSaved: tokensBefore - finalMessagesTokens,
    },
  };
}
