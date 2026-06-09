/**
 * 运行时参数构建器
 * 
 * 
 * 职责：
 * - 构建运行时信息
 * - 获取用户时区和时间
 * - 提供系统信息
 */

import os from 'os';
import type { RuntimeInfo, RuntimeParams } from '../../types/prompt';
import { getSystemTimezone, formatCurrentTime } from '../../shared/utils/datetime-utils';

/**
 * 构建运行时参数
 * 
 * @param params 参数
 * @returns 运行时参数
 */
export function buildRuntimeParams(params: {
  model: string;
  sessionId?: string;
}): RuntimeParams {
  const userTimezone = getSystemTimezone();
  const userTime = formatCurrentTime({ timezone: userTimezone });

  const runtimeInfo: RuntimeInfo = {
    model: params.model,
    sessionId: params.sessionId,
    os: `${os.platform()} ${os.release()}`,
  };

  return {
    runtimeInfo,
    userTimezone,
    userTime,
  };
}

/**
 * 构建运行时信息行
 * 
 * 用于在提示词中显示运行时信息
 */
export function buildRuntimeLine(runtimeInfo: RuntimeInfo): string {
  const parts: string[] = [];

  parts.push(`model=${runtimeInfo.model}`);

  if (runtimeInfo.sessionId) {
    parts.push(`session=${runtimeInfo.sessionId}`);
  }

  if (runtimeInfo.os) {
    parts.push(`os=${runtimeInfo.os}`);
  }

  return `Runtime: ${parts.join(' | ')}`;
}
