/**
 * 提示词系统类型定义
 */

/**
 * 上下文文件
 */
export interface ContextFile {
  /** 文件路径（相对于工作区） */
  path: string;
  /** 文件内容 */
  content: string;
  /** 是否被截断 */
  truncated?: boolean;
  /** 原始长度 */
  originalLength?: number;
}

/**
 * 运行时信息
 */
export interface RuntimeInfo {
  /** 模型 ID */
  model: string;
  /** Session ID */
  sessionId?: string;
  /** 操作系统 */
  os?: string;
}

/**
 * 系统提示词构建参数
 */
export interface SystemPromptParams {
  /** 工作区目录 */
  workspaceDir: string;
  
  /** Python 脚本目录 */
  scriptDir: string;
  
  /** Skill 目录列表 */
  skillDirs: string[];
  
  /** 默认 Skill 目录 */
  defaultSkillDir: string;
  
  /** 图片生成目录 */
  imageDir: string;
  
  /** 记忆管理目录 */
  memoryDir: string;
  
  /** 可用工具名称列表 */
  toolNames?: string[];
  
  /** 工具描述映射 */
  toolSummaries?: Record<string, string>;
  
  /** 运行时信息 */
  runtimeInfo?: RuntimeInfo;
  
  /** 用户时区 */
  userTimezone?: string;
  
  /** 当前时间 */
  userTime?: string;
  
  /** 上下文文件 */
  contextFiles?: ContextFile[];
  
  /** 额外的系统提示（动态注入） */
  extraSystemPrompt?: string;
}

/**
 * 运行时参数
 */
export interface RuntimeParams {
  /** 运行时信息 */
  runtimeInfo: RuntimeInfo;
  /** 用户时区 */
  userTimezone: string;
  /** 当前时间 */
  userTime: string;
}
