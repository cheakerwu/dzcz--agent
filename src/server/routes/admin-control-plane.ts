import { Router, RequestHandler } from 'express';
import type { AdminActionRequest } from '../../types/admin-control-plane';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { SystemConfigStore } from '../../main/database/system-config-store';
import { dispatchAdminControlPlaneAction } from '../../main/admin-control-plane/actions';

export function createAdminControlPlaneRouter(): Router {
  const router = Router();

  const handleAction: RequestHandler = async (req, res) => {
    try {
      const request = req.body as AdminActionRequest;
      const db = SystemConfigStore.getInstance().getDb();
      const data = await dispatchAdminControlPlaneAction(db, request);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };

  router.post('/', handleAction);

  return router;
}
