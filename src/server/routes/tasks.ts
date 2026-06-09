/**
 * 定时任务 API 路由
 */

import { Router, RequestHandler } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createTasksRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  /**
   * POST /api/tasks
   * 定时任务操作（list/create/update/delete）
   */
  const handleTask: RequestHandler = async (req, res) => {
    try {
      const request = req.body;
      const result = await gatewayAdapter.scheduledTask(request);
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: getErrorMessage(error) 
      });
    }
  };
  
  router.post('/', handleTask);
  
  return router;
}
