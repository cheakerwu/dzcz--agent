/**
 * 主题管理 Hook
 * 
 * 支持三种模式：light（浅色）、dark（深色）、auto（自动，根据时间切换）
 * - 自动模式：6:00-18:00 浅色，18:00-6:00 深色
 * - 主题偏好保存在 localStorage
 * - 默认深色
 */

import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'deepbot-theme-mode';

// 根据当前时间判断应该用浅色还是深色
function getAutoTheme(): 'light' | 'dark' {
  const hour = new Date().getHours();
  return (hour >= 6 && hour < 18) ? 'light' : 'dark';
}

// 应用主题到 DOM
function applyTheme(theme: 'light' | 'dark') {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved === 'light' || saved === 'dark' || saved === 'auto') ? saved : 'dark';
  });

  // 计算实际生效的主题
  const effectiveTheme = mode === 'auto' ? getAutoTheme() : mode;

  // 应用主题
  useEffect(() => {
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  // 自动模式下定时检查（每分钟）
  useEffect(() => {
    if (mode !== 'auto') return;

    const interval = setInterval(() => {
      applyTheme(getAutoTheme());
    }, 60000);

    return () => clearInterval(interval);
  }, [mode]);

  // 切换主题
  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  return { mode, effectiveTheme, setThemeMode };
}
