/**
 * 平台检测工具
 * 
 * 用于判断当前运行环境（Electron 或 Web）
 */

/**
 * 检查是否在 Electron 环境中运行
 */
export function isElectron(): boolean {
  return !!(window as any).electron;
}

/**
 * 检查是否在 Web 环境中运行
 */
export function isWeb(): boolean {
  return !isElectron();
}

/**
 * 获取当前平台名称
 */
export function getPlatform(): 'electron' | 'web' {
  return isElectron() ? 'electron' : 'web';
}

/**
 * 检查是否在 macOS 上运行
 */
export function isMacOS(): boolean {
  return navigator.platform?.toUpperCase().includes('MAC') || 
         navigator.userAgent?.includes('Macintosh');
}
