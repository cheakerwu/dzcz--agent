/**
 * 全局 Toast 通知工具
 * 
 * 使用事件总线模式，各组件直接调用 showToast()，无需 props 传递
 */

export type ToastType = 'success' | 'error' | 'wecom-agent' | 'wecom-direct';

export interface ToastEvent {
  type: ToastType;
  text: string;
  duration?: number; // 自定义持续时间（毫秒）
  onClick?: () => void; // 点击回调
}

type ToastListener = (event: ToastEvent) => void;

const listeners = new Set<ToastListener>();

/** 显示全局 Toast 通知 */
export function showToast(type: ToastType, text: string, options?: { duration?: number; onClick?: () => void }): void {
  listeners.forEach(fn => fn({ type, text, duration: options?.duration, onClick: options?.onClick }));
}

/** 订阅 Toast 事件（返回取消订阅函数） */
export function onToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
