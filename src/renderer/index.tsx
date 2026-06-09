/**
 * 渲染进程入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppWeb } from './AppWeb';
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// 🔥 根据环境变量选择 App 组件
const isWeb = import.meta.env.MODE === 'web';

root.render(
  isWeb ? <AppWeb /> : <App />
);
