import { SystemConfigStore } from '../../infrastructure/database/system-config-store';
import { getGatewayInstance } from '../../infrastructure/gateway/gateway';
import { MemoryGateway } from './memory-gateway';

export function buildAdminMemoryPromptContextForConnectorSession(input: {
  connectorId: string;
  conversationId: string;
  actorUserId?: string;
  actorEmployeeId?: string;
}): string {
  try {
    return new MemoryGateway(SystemConfigStore.getInstance().getDb()).buildPromptContext(input);
  } catch (error) {
    console.warn('[AdminControlPlane] 构建运营记忆提示词失败:', error);
    return '';
  }
}

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

    return buildAdminMemoryPromptContextForConnectorSession({
      connectorId: tab.connectorId,
      conversationId: tab.conversationId,
    });
  } catch (error) {
    console.warn('[AdminControlPlane] 构建运营记忆提示词失败:', error);
    return '';
  }
}
