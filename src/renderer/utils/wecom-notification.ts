/**
 * 智能客服消息通知工具
 * 
 * 收到智能客服消息时，显示 toast 通知并播放音效
 */

import type { AgentTab } from '../../types/agent-tab';
import { showToast } from './toast';
import { playNotificationSound } from './notification-sound';

/**
 * 触发智能客服消息通知
 * 
 * @param tab - 目标 Tab
 * @param content - 消息内容
 * @param isDirectMode - 是否为人工模式
 * @param onClickTab - 点击 toast 时切换到对应 Tab 的回调
 */
export function notifyWecomMessage(
  tab: AgentTab,
  content: string,
  isDirectMode: boolean,
  onClickTab: () => void,
): void {
  const tabTitle = tab.title || '智能客服';
  const toastType = isDirectMode ? 'wecom-direct' as const : 'wecom-agent' as const;
  const duration = isDirectMode ? 10000 : 5000;
  const preview = content.length > 50 ? content.slice(0, 50) + '...' : content;

  showToast(toastType, `📨 ${tabTitle}: ${preview}`, { duration, onClick: onClickTab });
  playNotificationSound();
}
