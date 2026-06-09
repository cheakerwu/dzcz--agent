/**
 * 时间格式化工具
 */

/**
 * 格式化持续时间（毫秒）为人类可读的格式
 * 
 * @param ms - 毫秒数
 * @returns 格式化后的字符串
 * 
 * @example
 * formatDuration(1500) // "1.5s"
 * formatDuration(65000) // "1m 5s"
 * formatDuration(3665000) // "1h 1m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  // 小于 1 分钟：显示秒（保留 1 位小数）
  if (seconds < 60) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  // 小于 1 小时：显示分钟和秒
  if (minutes < 60) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  // 1 小时以上：显示小时、分钟和秒
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  
  let result = `${hours}h`;
  if (remainingMinutes > 0) {
    result += ` ${remainingMinutes}m`;
  }
  if (remainingSeconds > 0) {
    result += ` ${remainingSeconds}s`;
  }
  
  return result;
}

/**
 * 格式化时间戳为人类可读的时间格式
 * 
 * @param timestamp - 毫秒时间戳
 * @returns 格式化后的时间字符串
 * 
 * @example
 * formatTimestamp(1709280000000) // "2024-03-01 12:00:00"
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
