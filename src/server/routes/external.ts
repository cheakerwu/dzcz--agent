/**
 * 外部调用 API 路由
 * 
 * 提供同步等待结果的对外接口，适合外部系统集成调用
 * 认证方式：请求头携带 X-Secret（值为 JWT_SECRET）
 * 
 * 接口列表：
 * - POST /api/external/message  信息接口（发送消息并等待 AI 回复）
 * - POST /api/external/command  指令接口（发送系统指令并等待执行结果）
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';
import { getErrorMessage } from '../../shared/utils/error-handler';

// 从环境变量读取 JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET || 'deepbot-default-secret-change-in-production';

// 外部接口默认超时：5 分钟
const EXTERNAL_API_TIMEOUT = parseInt(process.env.EXTERNAL_API_TIMEOUT || '') || 5 * 60 * 1000;

/**
 * 附件类型定义
 */
interface Attachment {
  name: string;       // 文件名（如 "photo.jpg"）
  data: string;       // base64 编码的文件内容（不含 data:xxx;base64, 前缀）
  type?: string;      // MIME 类型（如 "image/png"），可选，会自动推断
}

/**
 * 处理附件上传：保存到临时目录，返回路径列表
 */
async function processAttachments(
  gatewayAdapter: GatewayAdapter,
  attachments: Attachment[]
): Promise<{ images: string[]; files: string[] }> {
  const images: string[] = [];
  const files: string[] = [];
  
  for (const attachment of attachments) {
    const { name, data, type } = attachment;
    
    // 推断 MIME 类型
    const mimeType = type || guessMimeType(name);
    const isImage = mimeType.startsWith('image/');
    
    // 构建 dataUrl
    const dataUrl = `data:${mimeType};base64,${data}`;
    const fileSize = Buffer.from(data, 'base64').length;
    
    if (isImage) {
      const result = await gatewayAdapter.uploadImage(name, dataUrl, fileSize);
      if (result.success && result.image) {
        images.push(result.image.path);
      }
    } else {
      const result = await gatewayAdapter.uploadFile(name, dataUrl, fileSize, mimeType);
      if (result.success && result.file) {
        files.push(result.file.path);
      }
    }
  }
  
  return { images, files };
}

/**
 * 根据文件名推断 MIME 类型
 */
function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    // 图片
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    // 文档
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 文本
    txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    md: 'text/markdown', html: 'text/html', xml: 'application/xml',
    // 压缩
    zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
    // 音视频
    mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 外部接口认证中间件
 * 验证请求头 X-Secret 是否等于 JWT_SECRET
 */
function externalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-secret'] as string;
  
  if (!secret) {
    res.status(401).json({ success: false, error: '缺少 X-Secret 请求头' });
    return;
  }
  
  if (secret !== JWT_SECRET) {
    res.status(403).json({ success: false, error: 'Secret 无效' });
    return;
  }
  
  next();
}

/**
 * 根据 Tab 名称查找 Tab（去除空格后匹配）
 */
function findTabByName(gatewayAdapter: GatewayAdapter, tabName: string): { id: string; title: string } | null {
  const tabs = gatewayAdapter.getAllTabs();
  // 去除空格后匹配
  const normalizedName = tabName.replace(/\s+/g, '');
  
  const found = tabs.find(tab => {
    const normalizedTitle = tab.title.replace(/\s+/g, '');
    return normalizedTitle === normalizedName;
  });
  
  return found ? { id: found.id, title: found.title } : null;
}

/**
 * 等待 AI 回复完成
 * 监听 gatewayAdapter 的 message_stream 事件，收集内容直到 done=true
 * 返回 promise 和 cancel 函数（用于发送失败时清理监听器）
 */
function waitForResponse(
  gatewayAdapter: GatewayAdapter,
  tabId: string,
  timeout: number
): { promise: Promise<{ content: string; messageId: string; totalDuration?: number; modelId?: string }>; cancel: () => void } {
  let cleanup: () => void;
  
  const promise = new Promise<{ content: string; messageId: string; totalDuration?: number; modelId?: string }>((resolve, reject) => {
    let content = '';
    let messageId = '';
    let resolved = false;
    
    // 超时处理
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        doCleanup();
        reject(new Error(`等待回复超时（${Math.round(timeout / 1000)}秒）`));
      }
    }, timeout);
    
    // 监听流式消息
    const onStream = (event: any) => {
      if (resolved) return;
      if (event.sessionId !== tabId) return;
      
      // 跳过用户消息
      if (event.role === 'user') return;
      
      // 记录 messageId
      if (event.messageId) {
        messageId = event.messageId;
      }
      
      // 拼接内容
      if (event.content) {
        content += event.content;
      }
      
      // 完成
      if (event.done) {
        resolved = true;
        clearTimeout(timer);
        doCleanup();
        resolve({
          content,
          messageId,
          totalDuration: event.totalDuration,
          modelId: event.modelId,
        });
      }
    };
    
    // 监听错误
    const onError = (event: any) => {
      if (resolved) return;
      if (event.sessionId !== tabId) return;
      
      resolved = true;
      clearTimeout(timer);
      doCleanup();
      reject(new Error(event.error || 'Agent 执行出错'));
    };
    
    // 清理监听器
    const doCleanup = () => {
      gatewayAdapter.removeListener('message_stream', onStream);
      gatewayAdapter.removeListener('message_error', onError);
    };
    
    // 暴露 cleanup 供外部 cancel 调用
    cleanup = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        doCleanup();
      }
    };
    
    // 注册监听器
    gatewayAdapter.on('message_stream', onStream);
    gatewayAdapter.on('message_error', onError);
  });
  
  return { promise, cancel: () => cleanup() };
}

export function createExternalRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  // 所有外部接口都需要 X-Secret 认证
  router.use(externalAuthMiddleware);
  
  /**
   * POST /api/external/message
   * 信息接口 - 发送消息并同步等待 AI 回复
   * 
   * 请求头：
   *   X-Secret: JWT_SECRET 的值
   * 
   * 请求体：
   *   { tab: "Tab名称", content: "消息内容", timeout?: 超时毫秒数, fast?: boolean, attachments?: Attachment[] }
   * 
   * attachments 格式：
   *   [{ name: "photo.jpg", data: "base64内容", type?: "image/jpeg" }]
   * 
   * 响应：
   *   { success: true, reply: "AI回复内容", messageId, totalDuration, modelId }
   * 
   * fast 参数说明：
   *   传入 fast: true 时，Tab 进入 Fast 模式（不组装 AGENT.md/TOOLS.md/Skills，只保留 memory + 工作提示词）
   *   传入 fast: false 或不传时，Tab 恢复正常模式
   */
  const sendMessage: RequestHandler = async (req, res) => {
    try {
      const { tab: tabName, content, timeout, fast, attachments } = req.body;
      
      // 参数校验
      if (!tabName) {
        res.status(400).json({ success: false, error: '缺少 tab 参数' });
        return;
      }
      if (!content && (!attachments || attachments.length === 0)) {
        res.status(400).json({ success: false, error: '缺少 content 或 attachments 参数' });
        return;
      }
      
      // 查找 Tab，不存在则自动创建
      let tab = findTabByName(gatewayAdapter, tabName);
      let created = false;
      if (!tab) {
        const newTab = await gatewayAdapter.createTab(tabName);
        tab = { id: newTab.id, title: newTab.title };
        created = true;
      }
      
      // 设置 Fast 模式（仅在明确传入 fast 参数时才改变模式）
      if (fast !== undefined) {
        gatewayAdapter.setTabFastMode(tab.id, fast === true);
      }
      
      // 处理附件上传
      let messageContent = content || '';
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        const { images, files } = await processAttachments(gatewayAdapter, attachments);
        
        // 将文件路径拼接到消息内容前面（与前端逻辑一致）
        if (images.length > 0) {
          const imagePaths = images.map((p, i) => `[参考图${i + 1}]: ${p}`).join('\n');
          messageContent = `${imagePaths}\n\n${messageContent}`;
        }
        if (files.length > 0) {
          const filePaths = files.map((p, i) => `[参考文件${i + 1}]: ${p}`).join('\n');
          messageContent = `${filePaths}\n\n${messageContent}`;
        }
      }
      
      // 确定超时时间
      const requestTimeout = timeout || EXTERNAL_API_TIMEOUT;
      
      // 先注册监听器，再发送消息（避免竞态条件）
      const { promise: responsePromise, cancel } = waitForResponse(gatewayAdapter, tab.id, requestTimeout);
      
      // 发送消息（使用处理过附件的完整内容）
      try {
        await gatewayAdapter.handleSendMessage(tab.id, messageContent);
      } catch (sendError) {
        cancel();
        throw sendError;
      }
      
      // 等待 AI 回复
      const result = await responsePromise;
      
      res.json({
        success: true,
        tab: tab.title,
        tabCreated: created,
        reply: result.content,
        messageId: result.messageId,
        totalDuration: result.totalDuration,
        modelId: result.modelId,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
  
  /**
   * POST /api/external/command
   * 指令接口 - 发送系统指令并同步等待执行结果
   * 
   * 请求头：
   *   X-Secret: JWT_SECRET 的值
   * 
   * 请求体：
   *   { tab: "Tab名称", command: "指令内容", timeout?: 超时毫秒数, fast?: boolean }
   * 
   * 响应：
   *   { success: true, result: "Agent执行结果", messageId, totalDuration, modelId }
   * 
   * 说明：
   *   指令以 [SYSTEM] 前缀发送，Agent 会将其视为系统指令执行
   *   fast 参数：同信息接口，控制 Tab 的 Fast 模式
   */
  const sendCommand: RequestHandler = async (req, res) => {
    try {
      const { tab: tabName, command, timeout, fast } = req.body;
      
      // 参数校验
      if (!tabName) {
        res.status(400).json({ success: false, error: '缺少 tab 参数' });
        return;
      }
      if (!command) {
        res.status(400).json({ success: false, error: '缺少 command 参数' });
        return;
      }
      
      // 查找 Tab（指令接口不自动创建，必须在已有 Tab 执行）
      const tab = findTabByName(gatewayAdapter, tabName);
      if (!tab) {
        res.status(404).json({ success: false, error: `未找到名为 "${tabName}" 的 Tab` });
        return;
      }
      
      // 设置 Fast 模式（仅在明确传入 fast 参数时才改变模式）
      if (fast !== undefined) {
        gatewayAdapter.setTabFastMode(tab.id, fast === true);
      }
      
      // 确定超时时间
      const requestTimeout = timeout || EXTERNAL_API_TIMEOUT;
      
      // 先注册监听器，再发送消息（避免竞态条件）
      const { promise: responsePromise, cancel } = waitForResponse(gatewayAdapter, tab.id, requestTimeout);
      
      // 发送系统指令（添加 [SYSTEM] 前缀）
      const systemCommand = `[SYSTEM] ${command}`;
      try {
        await gatewayAdapter.handleSendMessage(tab.id, systemCommand);
      } catch (sendError) {
        cancel();
        throw sendError;
      }
      
      // 等待执行结果
      const result = await responsePromise;
      
      res.json({
        success: true,
        tab: tab.title,
        result: result.content,
        messageId: result.messageId,
        totalDuration: result.totalDuration,
        modelId: result.modelId,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
  
  router.post('/message', sendMessage);
  router.post('/command', sendCommand);
  
  return router;
}
