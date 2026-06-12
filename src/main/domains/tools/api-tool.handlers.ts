/**
 * API 工具处理函数 - 主入口文件
 * 
 * 重构后的模块化架构，按功能职责拆分为多个子模块：
 * - config-handlers: 配置管理相关功能
 * - tool-check-handlers: 工具状态检查功能  
 * - name-session-handlers: 名称配置和会话时间功能
 * - connector-handlers: 连接器管理相关功能
 * 
 * 本文件作为主入口，重新导出所有函数以保持向后兼容性
 */

// ==================== 重新导出所有处理函数 ====================

// 配置管理相关
export {
  handleGetConfig,
  handleSetWorkspaceConfig,
  handleSetModelConfig,
  handleSetImageGenerationConfig,
  handleSetWebSearchConfig,
  handleSetToolEnabled,
} from './handlers/config-handlers';

// 名称配置和会话时间相关
export {
  handleGetNameConfig,
  handleSetNameConfig,
  handleGetSessionFilePath,
  handleGetDateTime,
} from './handlers/name-session-handlers';

// 连接器管理相关
export {
  handleSetFeishuConnectorConfig,
  handleSetConnectorEnabled,
  handleGetPairingRecords,
  handleApprovePairing,
  handleRejectPairing,
  handleGetTabs,
} from './handlers/connector-handlers';

// 工具状态检查相关（内部使用，不需要导出）
// checkBrowserToolStatus 和 checkEmailToolConfig 已在 config-handlers 中使用