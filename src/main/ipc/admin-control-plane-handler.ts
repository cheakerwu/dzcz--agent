import { IPC_CHANNELS } from '../../types/ipc';
import type { AdminActionRequest } from '../../types/admin-control-plane';
import { registerIpcHandler } from '../../shared/utils/ipc-utils';
import { SystemConfigStore } from '../database/system-config-store';
import { dispatchAdminControlPlaneAction } from '../admin-control-plane/actions';

export function registerAdminControlPlaneHandlers(): void {
  registerIpcHandler<AdminActionRequest, unknown>(
    IPC_CHANNELS.ADMIN_CONTROL_PLANE_REQUEST,
    async (_event, request): Promise<unknown> => {
      const db = SystemConfigStore.getInstance().getDb();
      return dispatchAdminControlPlaneAction(db, request);
    }
  );
}
