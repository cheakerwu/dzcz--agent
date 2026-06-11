/**
 * 工具分组配置
 *
 * 将工具分为两层：
 * - 核心层（Core）：始终暴露，覆盖基础文件操作、命令执行、网页获取、记忆管理
 * - 按需层（On-demand）：根据用户消息内容动态注入
 *
 * 设计原则：
 * - 核心工具覆盖 80% 的日常场景
 * - 专业工具按需加载，减少每次请求的 token 消耗
 * - 关键词匹配是确定性的，不依赖额外 LLM 调用
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';

/**
 * 工具组名称
 */
export type ToolGroupName =
  | 'core'
  | 'browser'
  | 'calendar'
  | 'image'
  | 'search'
  | 'media'
  | 'email'
  | 'skill'
  | 'scheduled'
  | 'env'
  | 'chat'
  | 'feishu'
  | 'wechat'
  | 'wecom'
  | 'connector'
  | 'smartkf'
  | 'crosstab'
  | 'api'
  | 'command'
  | 'mcp';

/**
 * 工具组定义
 *
 * 每个组包含一组工具名前缀，匹配规则：
 * - 精确匹配：工具名完全等于配置值
 * - 前缀匹配：工具名以 `*` 结尾，匹配该前缀
 */
export const TOOL_GROUPS: Record<ToolGroupName, string[]> = {
  // 核心工具：始终暴露
  core: ['read', 'write', 'edit', 'bash', 'web_fetch', 'memory'],

  // 浏览器工具
  browser: ['browser', 'browser_act'],

  // 日历工具
  calendar: ['calendar_'],

  // 图片生成
  image: ['image_generation'],

  // 网络搜索
  search: ['web_search'],

  // 多媒体/文档分析/OCR
  media: ['media_analysis', 'doc_analysis', 'ocr_image', 'ocr_pdf'],

  // 邮件
  email: ['send_email'],

  // Skill 管理
  skill: ['skill_manager'],

  // 定时任务
  scheduled: ['scheduled_task'],

  // 环境检查
  env: ['environment_check'],

  // AI 对话
  chat: ['chat'],

  // 飞书（云文档 + 消息卡片 + 多维表格 + 连接器中的飞书工具）
  feishu: ['feishu_'],

  // 微信
  wechat: ['wechat_'],

  // 企业微信
  wecom: ['wecom_'],

  // 连接器（飞书发送图片/文件/消息）
  connector: ['feishu_send_image', 'feishu_send_file', 'feishu_send_message'],

  // 智能客服
  smartkf: ['smart_kf_'],

  // 跨 Tab 调用
  crosstab: ['cross_tab_call'],

  // API 工具
  api: ['api_'],

  // 系统指令
  command: ['system_command'],

  // MCP 工具
  mcp: ['mcp__'],
};

/**
 * 关键词 → 工具组映射
 *
 * 当用户消息中包含这些关键词时，自动注入对应的工具组。
 * 匹配不区分大小写。
 */
export const KEYWORD_TRIGGERS: Record<ToolGroupName, string[]> = {
  core: [], // 核心工具始终注入，无需触发
  browser: ['打开网页', '浏览', '浏览器', '网页', 'open browser', 'browse', 'website', 'url', 'http'],
  calendar: ['日历', '日程', '会议', '安排', 'calendar', 'meeting', 'schedule', 'appointment'],
  image: ['图片生成', '生成图', '画一', '画个', 'generate image', 'draw', 'create image', '生成图片', '生成海报'],
  search: ['搜索', '搜一下', '查一下', 'search', 'google', '查找', 'look up'],
  media: ['视频', '音频', '图片分析', '多媒体', 'OCR', 'video', 'audio', 'image analysis', '识别图片', '分析图片', '识别文字', '提取文字', '截图识别', 'ocr'],
  email: ['邮件', '发送邮件', '发邮件', 'email', 'send email', 'mail'],
  skill: ['skill', '技能', '安装skill', 'install skill', '查找skill'],
  scheduled: ['定时', '计划任务', '提醒我', 'cron', 'schedule task', 'timer', 'reminder'],
  env: ['环境检查', '环境变量', '检查环境', 'environment check'],
  chat: ['对话', '聊天', '问问', 'chat', 'ask AI'],
  feishu: ['飞书', 'feishu', 'lark', '云文档', '多维表格', '消息卡片'],
  wechat: ['微信', 'wechat'],
  wecom: ['企业微信', 'wecom', '企业号'],
  connector: ['发送图片', '发送文件', 'send image', 'send file'],
  smartkf: ['智能客服', 'smart kf', '客服'],
  crosstab: ['跨tab', '跨tab调用', 'cross tab', '协作'],
  api: ['系统配置', '获取配置', 'set config', 'get config', '设置模型'],
  command: ['系统指令', '新建对话', '/new', 'system command'],
  mcp: ['mcp工具', 'mcp server', 'mcp工具调用'],
};

/**
 * 判断工具名是否匹配某个工具组的模式
 *
 * @param toolName - 工具名称
 * @param patterns - 工具组的匹配模式列表
 * @returns 是否匹配
 */
function matchesGroup(toolName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('_')) {
      // 前缀匹配
      if (toolName.startsWith(pattern)) return true;
    } else if (pattern.endsWith('__')) {
      // MCP 前缀匹配
      if (toolName.startsWith(pattern)) return true;
    } else {
      // 精确匹配
      if (toolName === pattern) return true;
    }
  }
  return false;
}

/**
 * 根据工具组名称筛选工具
 *
 * @param tools - 所有工具
 * @param groupName - 工具组名称
 * @returns 该组的工具列表
 */
export function filterToolsByGroup(tools: AgentTool[], groupName: ToolGroupName): AgentTool[] {
  const patterns = TOOL_GROUPS[groupName];
  if (!patterns) return [];
  return tools.filter((tool) => matchesGroup(tool.name, patterns));
}

/**
 * 根据用户消息检测需要注入的工具组
 *
 * @param userMessage - 用户消息内容
 * @returns 需要注入的工具组名称列表（不包含 core）
 */
export function detectTriggeredGroups(userMessage: string): ToolGroupName[] {
  const message = userMessage.toLowerCase();
  const triggered: ToolGroupName[] = [];

  for (const [groupName, keywords] of Object.entries(KEYWORD_TRIGGERS) as [ToolGroupName, string[]][]) {
    if (groupName === 'core') continue; // 核心工具始终注入
    if (keywords.length === 0) continue;

    for (const keyword of keywords) {
      if (message.includes(keyword.toLowerCase())) {
        triggered.push(groupName);
        break;  // 一个组只需一个关键词匹配
      }
    }
  }

  return triggered;
}

/**
 * 渐进式工具选择
 *
 * 根据用户消息选择需要暴露的工具子集：
 * 1. 核心工具始终包含
 * 2. 根据消息关键词匹配注入对应工具组
 * 3. 去重（避免同一个工具被多个组包含）
 *
 * @param allTools - 所有已加载的工具
 * @param userMessage - 用户消息
 * @returns 本次请求应暴露的工具列表
 */
export function selectToolsProgressively(
  allTools: AgentTool[],
  userMessage: string
): AgentTool[] {
  // 1. 核心工具
  const coreTools = filterToolsByGroup(allTools, 'core');

  // 2. 检测触发的工具组
  const triggeredGroups = detectTriggeredGroups(userMessage);

  // 3. 收集按需工具
  const onDemandTools: AgentTool[] = [];
  const seenNames = new Set(coreTools.map((t) => t.name));

  for (const groupName of triggeredGroups) {
    const groupTools = filterToolsByGroup(allTools, groupName);
    for (const tool of groupTools) {
      if (!seenNames.has(tool.name)) {
        seenNames.add(tool.name);
        onDemandTools.push(tool);
      }
    }
  }

  const selected = [...coreTools, ...onDemandTools];

  // 日志：记录工具筛选结果
  if (triggeredGroups.length > 0) {
    console.log(
      `🔧 渐进式披露: ${allTools.length} → ${selected.length} 个工具 ` +
      `(核心: ${coreTools.length}, 按需: ${onDemandTools.length}, 触发组: ${triggeredGroups.join(', ')})`
    );
  } else {
    console.log(`🔧 渐进式披露: ${allTools.length} → ${selected.length} 个工具 (仅核心)`);
  }

  return selected;
}
