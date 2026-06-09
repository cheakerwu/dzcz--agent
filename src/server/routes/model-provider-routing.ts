/**
 * 模型服务商路由配置 API
 * 用于 Docker/Web 模式下的 GET/POST 路由
 */

import { Router, RequestHandler } from 'express';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createModelProviderRoutingRouter(): Router {
  const router = Router();

  /**
   * GET /api/model-provider-routing?modelId=xxx
   * 获取指定模型的服务商路由配置
   */
  const getRouting: RequestHandler = async (req, res) => {
    try {
      const modelId = req.query.modelId as string;
      if (!modelId) {
        return res.status(400).json({ success: false, error: 'modelId is required' });
      }
      const { SystemConfigStore } = await import('../../main/database/system-config-store');
      const store = SystemConfigStore.getInstance();
      // 优先从数据库读取，没有则返回默认值
      const routing = store.getModelProviderRouting(modelId) || store.getDefaultModelProviderRouting(modelId);
      res.json({ success: true, routing });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };

  /**
   * POST /api/model-provider-routing
   * 保存模型服务商路由配置
   * Body: { modelId, providerOrder, allowFallbacks }
   */
  const saveRouting: RequestHandler = async (req, res) => {
    try {
      const { modelId, providerOrder, allowFallbacks } = req.body;
      if (!modelId) {
        return res.status(400).json({ success: false, error: 'modelId is required' });
      }
      const { SystemConfigStore } = await import('../../main/database/system-config-store');
      const store = SystemConfigStore.getInstance();
      if (providerOrder) {
        store.saveModelProviderRouting(modelId, providerOrder, allowFallbacks ?? false);
      } else {
        // providerOrder 为空时删除配置
        store.deleteModelProviderRouting(modelId);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };

  router.get('/', getRouting);
  router.post('/', saveRouting);

  return router;
}
