/**
 * Token 用量统计 API 路由
 */

import { Router, RequestHandler } from 'express';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createTokenUsageRouter(): Router {
  const router = Router();

  /**
   * GET /api/token-usage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   * 查询指定日期范围的 token 用量
   */
  const getTokenUsage: RequestHandler = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ success: false, error: 'startDate 和 endDate 参数必填', records: [] });
        return;
      }

      const { getTokenUsage: queryTokenUsage } = await import('../../main/infrastructure/database/token-usage');
      const { SystemConfigStore } = await import('../../main/infrastructure/database/system-config-store');
      const db = SystemConfigStore.getInstance().getDb();
      const records = queryTokenUsage(db, startDate as string, endDate as string);
      res.json({ success: true, records });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error), records: [] });
    }
  };

  router.get('/', getTokenUsage);

  /**
   * DELETE /api/token-usage/:modelId
   * 重置指定模型的用量数据
   */
  const resetUsage: RequestHandler = async (req, res) => {
    try {
      const rawModelId = req.params.modelId;
      const modelId = Array.isArray(rawModelId) ? rawModelId[0] : rawModelId;
      if (!modelId) {
        res.status(400).json({ success: false, error: 'modelId 参数必填' });
        return;
      }

      const { resetTokenUsage } = await import('../../main/infrastructure/database/token-usage');
      const { SystemConfigStore } = await import('../../main/infrastructure/database/system-config-store');
      const db = SystemConfigStore.getInstance().getDb();
      resetTokenUsage(db, decodeURIComponent(modelId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };

  router.delete('/:modelId', resetUsage);

  return router;
}
