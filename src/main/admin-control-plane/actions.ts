import type Database from '../../shared/utils/sqlite-adapter';
import type { AdminActionRequest } from '../../types/admin-control-plane';
import { BrowserActControlService } from '../browser-act/browser-act-control-service';
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
    case 'platformAccounts.list':
      return service.listPlatformAccounts();
    case 'platformAccounts.create':
      return service.createPlatformAccount(payload.input, payload.actorId);
    case 'browserLoginRequests.list':
      return service.listBrowserLoginRequests(payload?.filter || {});
    case 'browserLoginRequests.create':
      return service.createBrowserLoginRequest(payload.input, payload.actorId);
    case 'browserLoginRequests.markWaiting':
      return service.markBrowserLoginRequestWaiting(payload.id, payload.browserActBrowserId, payload.actorId);
    case 'browserLoginRequests.markHealthy':
      return service.markBrowserLoginRequestHealthy(payload.id, payload.browserProfileId, payload.actorId);
    case 'browserLoginRequests.markFailed':
      return service.markBrowserLoginRequestFailed(payload.id, payload.reason, payload.actorId);
    case 'browserLoginRequests.cancel':
      return service.markBrowserLoginRequestCancelled(payload.id, payload.actorId);
    case 'browserLoginRequests.expire':
      return { expiredCount: service.expireBrowserLoginRequests(payload?.nowMs) };
    case 'browserProfiles.list':
      return service.listBrowserProfiles();
    case 'browserProfiles.create':
      return service.createBrowserProfile(payload.input, payload.actorId);
    case 'browserProfiles.importFromBrowserAct':
      return service.upsertBrowserProfileFromBrowserAct(payload.input, payload.actorId);
    case 'browserProfilePermissions.grant':
      return service.grantBrowserProfilePermission(payload.input, payload.actorId);
    case 'browserAct.browsers.list':
      return new BrowserActControlService({ workspaceDir: process.cwd() }).listBrowsers();
    case 'auditEvents.list':
      return service.listAuditEvents(payload?.filter || {});
    default:
      throw new Error(`未知管理后台动作: ${request.action}`);
  }
}
