import type Database from '../../shared/utils/sqlite-adapter';
import type { AdminActionRequest } from '../../types/admin-control-plane';
import { AdminControlPlaneService } from './service';

export async function dispatchAdminControlPlaneAction(
  db: Database.Database,
  request: AdminActionRequest
): Promise<unknown> {
  const service = new AdminControlPlaneService(db);
  const payload = request.payload as any;

  switch (request.action) {
    case 'dashboard.get':
      return service.getDashboard();
    case 'stores.list':
      return service.listStores();
    case 'stores.create':
      return service.createStore(payload.input, payload.actorId);
    case 'stores.update':
      return service.updateStore(payload.id, payload.input, payload.actorId);
    case 'employees.list':
      return service.listEmployees();
    case 'employees.upsert':
      return service.upsertEmployee(payload.input, payload.actorId);
    case 'employees.offboard':
      service.offboardEmployee(payload.employeeId, payload.actorId);
      return { employeeId: payload.employeeId };
    case 'conversations.list':
      return service.listFeishuConversations();
    case 'conversations.upsert':
      return service.upsertFeishuConversation(payload.input, payload.actorId);
    case 'conversationStoreBindings.create':
      return service.bindConversationToStore(payload.input, payload.actorId);
    case 'storeAssignments.create':
      return service.assignEmployeeToStore(payload.input, payload.actorId);
    case 'memories.list':
      return service.listMemoryItems(payload?.filter || {});
    case 'memories.create':
      return service.createMemoryItem(payload.input, payload.actorId);
    case 'memories.updateStatus':
      return service.updateMemoryStatus(payload.id, payload.status, payload.actorId);
    case 'memories.sync':
      return service.syncMemoryItemToProvider(payload.memoryId, payload.actorId);
    case 'browserProfiles.list':
      return service.listBrowserProfiles();
    case 'browserProfiles.create':
      return service.createBrowserProfile(payload.input, payload.actorId);
    case 'browserProfilePermissions.grant':
      return service.grantBrowserProfilePermission(payload.input, payload.actorId);
    case 'auditEvents.list':
      return service.listAuditEvents(payload?.filter || {});
    default:
      throw new Error(`未知管理后台动作: ${request.action}`);
  }
}
