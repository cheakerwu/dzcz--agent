/**
 * Web 模式入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppWeb } from './AppWeb';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWeb />
  </React.StrictMode>
);
