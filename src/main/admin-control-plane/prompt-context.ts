import { SystemConfigStore } from '../database/system-config-store';
import { getGatewayInstance } from '../gateway';
import { AdminControlPlaneService } from './service';

export function buildAdminMemoryPromptContextForSession(sessionId?: string): string {
  try {
    if (!sessionId || sessionId === 'default') {
      return '';
    }

    const gateway = getGatewayInstance();
    const tab = gateway?.getAllTabs().find((item) => item.id === sessionId);
    if (!tab?.connectorId || !tab.conversationId) {
      return '';
    }

    const service = new AdminControlPlaneService(SystemConfigStore.getInstance().getDb());
    return service.buildPromptContextForConnectorSession({
      connectorId: tab.connectorId,
      conversationId: tab.conversationId,
    });
  } catch (error) {
    console.warn('[AdminControlPlane] 构建运营记忆提示词失败:', error);
    return '';
  }
}
