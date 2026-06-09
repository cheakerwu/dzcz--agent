/**
 * 快速响应的 Tooltip 组件
 * 
 * 功能：
 * - 0.2秒延迟显示
 * - 自动定位（上方显示）
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
  children: React.ReactElement;
  delay?: number; // 延迟时间（毫秒），默认 200ms
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  content, 
  children, 
  delay = 200 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    // 直接从事件目标获取位置
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    
    // 计算 tooltip 位置（按钮中心的 x 坐标，按钮顶部的 y 坐标）
    const x = rect.left + rect.width / 2;
    const y = rect.top;
    
    setPosition({ x, y });

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // 克隆子元素并添加事件处理器
  const childWithEvents = React.cloneElement(children, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  } as any);

  // 使用 Portal 将 tooltip 渲染到 body 下
  const tooltipElement = isVisible ? createPortal(
    <div 
      className="tooltip-content"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {content.split('\n').map((line, index, array) => (
        <React.Fragment key={index}>
          {line}
          {index < array.length - 1 && <br />}
        </React.Fragment>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <>
      {childWithEvents}
      {tooltipElement}
    </>
  );
};
