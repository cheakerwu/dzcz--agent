/**
 * 路径处理工具
 * 
 * 提供路径展开、解析等功能
 */

import * as os from 'os';
import * as path from 'path';

/**
 * 展开用户路径（支持 ~ 符号）
 * 
 * @param input - 输入路径（可能包含 ~）
 * @returns 展开后的绝对路径
 * 
 * @example
 * expandUserPath('~/Desktop/image.jpg') // '/Users/username/Desktop/image.jpg'
 * expandUserPath('/absolute/path') // '/absolute/path'
 * expandUserPath('relative/path') // '/current/working/dir/relative/path'
 */
export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  
  // 展开 ~ 为用户主目录
  if (trimmed.startsWith('~')) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  
  // 解析为绝对路径
  return path.resolve(trimmed);
}

/**
 * 检查路径是否以 ~ 开头
 */
export function startsWithTilde(input: string): boolean {
  return input.trim().startsWith('~');
}

/**
 * 获取用户主目录
 */
export function getUserHomeDir(): string {
  return os.homedir();
}
