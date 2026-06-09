/**
 * 工具相关 API 路由
 */

import { Router, RequestHandler } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createToolsRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  /**
   * POST /api/tools/environment-check
   * 环境检查
   */
  const checkEnvironment: RequestHandler = async (req, res) => {
    try {
      const { action } = req.body;
      
      // 调用 Gateway 的环境检查工具
      const result = await gatewayAdapter.checkEnvironment(action);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: getErrorMessage(error) 
      });
    }
  };
  
  /**
   * POST /api/tools/launch-chrome
   * 启动 Chrome 调试
   */
  const launchChrome: RequestHandler = async (req, res) => {
    try {
      const { port } = req.body;
      
      // 调用 Gateway 的启动 Chrome 方法
      const result = await gatewayAdapter.launchChromeWithDebug(port);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: getErrorMessage(error) 
      });
    }
  };
  
  router.post('/environment-check', checkEnvironment);
  router.post('/launch-chrome', launchChrome);
  
  return router;
}
