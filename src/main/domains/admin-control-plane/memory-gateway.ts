import type Database from '../../../shared/utils/sqlite-adapter';
import type {
  AdminMemoryItem,
  BuildMemoryGatewayPromptInput,
  MemoryEntityLinkInput,
  PolicyDecision,
} from '../../../types/admin-control-plane';
import { initAdminControlPlaneTables } from './schema';
import { PolicyService } from './policy-service';

type Row = Record<string, any>;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapMemory(row: Row, links: MemoryEntityLinkInput[]): AdminMemoryItem {
  return {
    id: row.id,
    provider: row.provider,
    providerMemoryId: optionalString(row.provider_memory_id),
    scope: row.scope,
    category: optionalString(row.category),
    content: row.content,
    status: row.status,
    confidence: Number(row.confidence ?? 0.5),
    expiresAt: row.expires_at ?? undefined,
    createdBy: optionalString(row.created_by),
    approvedBy: optionalString(row.approved_by),
    lastUsedAt: row.last_used_at ?? undefined,
    supersedesId: optionalString(row.supersedes_id),
    entityLinks: links,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoryGateway {
  private readonly policyService: PolicyService;

  constructor(private readonly db: Database.Database, policyService?: PolicyService) {
    this.policyService = policyService || new PolicyService(db);
  }

  buildPromptContext(input: BuildMemoryGatewayPromptInput): string {
    initAdminControlPlaneTables(this.db);

    const decision = this.policyService.evaluateMemoryRead({
      connectorId: input.connectorId,
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      actorEmployeeId: input.actorEmployeeId,
      action: 'memory.read',
    });

    if (decision.effect === 'deny' || !decision.conversationInternalId) {
      return '';
    }

    const conversation = this.getConversation(decision.conversationInternalId);
    if (!conversation) {
      return '';
    }

    const stores = this.getStores(decision.allowedStoreIds);
    const enterpriseMemory = decision.allowedMemoryScopes.includes('enterprise')
      ? this.getEnterpriseMemory()
      : [];
    const conversationMemory = decision.allowedMemoryScopes.includes('conversation')
      ? [
          ...this.getConversationMemory(decision.conversationInternalId),
          ...this.getStoreLinkedMemory(decision.allowedStoreIds),
        ]
      : [];
    const employeeMemory = decision.allowedMemoryScopes.includes('employee') && decision.actorEmployeeId
      ? this.getEmployeeMemory(decision.actorEmployeeId)
      : [];
    const browserProfiles = this.getBrowserProfiles(decision);

    return this.formatPromptContext({
      conversation,
      stores,
      enterpriseMemory,
      conversationMemory: this.dedupeMemory(conversationMemory),
      employeeMemory,
      browserProfiles,
    });
  }

  private getConversation(conversationInternalId: string): Row | undefined {
    return this.db.prepare(`
      SELECT * FROM feishu_conversations WHERE id = ? AND status = 'active'
    `).get(conversationInternalId) as Row | undefined;
  }

  private getStores(storeIds: string[]): Row[] {
    if (storeIds.length === 0) {
      return [];
    }

    return this.db.prepare(`
      SELECT * FROM stores
      WHERE id IN (${storeIds.map(() => '?').join(',')})
        AND status != 'closed'
      ORDER BY name ASC
    `).all(...storeIds) as Row[];
  }

  private getEnterpriseMemory(): AdminMemoryItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_items
      WHERE status = 'active'
        AND scope = 'enterprise'
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 20
    `).all() as Row[];
    return rows.map((row) => this.mapMemoryWithLinks(row));
  }

  private getConversationMemory(conversationId: string): AdminMemoryItem[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT mi.* FROM memory_items mi
      JOIN memory_entity_links mel ON mel.memory_id = mi.id
      WHERE mi.status = 'active'
        AND mi.scope = 'conversation'
        AND mel.entity_type = 'conversation'
        AND mel.entity_id = ?
      ORDER BY mi.confidence DESC, mi.updated_at DESC
      LIMIT 20
    `).all(conversationId) as Row[];
    return rows.map((row) => this.mapMemoryWithLinks(row));
  }

  private getStoreLinkedMemory(storeIds: string[]): AdminMemoryItem[] {
    if (storeIds.length === 0) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT DISTINCT mi.* FROM memory_items mi
      JOIN memory_entity_links mel ON mel.memory_id = mi.id
      WHERE mi.status = 'active'
        AND mi.scope IN ('store', 'task')
        AND mel.entity_type = 'store'
        AND mel.entity_id IN (${storeIds.map(() => '?').join(',')})
      ORDER BY mi.confidence DESC, mi.updated_at DESC
      LIMIT 30
    `).all(...storeIds) as Row[];
    return rows.map((row) => this.mapMemoryWithLinks(row));
  }

  private getEmployeeMemory(employeeId: string): AdminMemoryItem[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT mi.* FROM memory_items mi
      JOIN memory_entity_links mel ON mel.memory_id = mi.id
      WHERE mi.status = 'active'
        AND mi.scope = 'employee'
        AND mel.entity_type = 'employee'
        AND mel.entity_id = ?
      ORDER BY mi.confidence DESC, mi.updated_at DESC
      LIMIT 20
    `).all(employeeId) as Row[];
    return rows.map((row) => this.mapMemoryWithLinks(row));
  }

  private getBrowserProfiles(decision: PolicyDecision): Row[] {
    if (decision.allowedBrowserProfileIds.length === 0) {
      return [];
    }

    return this.db.prepare(`
      SELECT * FROM browser_profiles
      WHERE id IN (${decision.allowedBrowserProfileIds.map(() => '?').join(',')})
      ORDER BY platform ASC, label ASC
    `).all(...decision.allowedBrowserProfileIds) as Row[];
  }

  private mapMemoryWithLinks(row: Row): AdminMemoryItem {
    const links = (this.db.prepare(`
      SELECT entity_type, entity_id FROM memory_entity_links
      WHERE memory_id = ?
      ORDER BY created_at ASC
    `).all(row.id) as Row[]).map((link) => ({
      entityType: link.entity_type,
      entityId: link.entity_id,
    }));
    return mapMemory(row, links);
  }

  private dedupeMemory(items: AdminMemoryItem[]): AdminMemoryItem[] {
    const seen = new Set<string>();
    const result: AdminMemoryItem[] = [];

    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }

    return result;
  }

  private formatPromptContext(input: {
    conversation: Row;
    stores: Row[];
    enterpriseMemory: AdminMemoryItem[];
    conversationMemory: AdminMemoryItem[];
    employeeMemory: AdminMemoryItem[];
    browserProfiles: Row[];
  }): string {
    const lines: string[] = [];
    lines.push(`会话: ${input.conversation.name || input.conversation.conversation_id} (${input.conversation.chat_type})`);

    if (input.stores.length > 0) {
      lines.push('关联门店:');
      for (const store of input.stores) {
        const location = [store.city, store.area].filter(Boolean).join(' ');
        lines.push(`- ${store.name}${store.brand ? ` / ${store.brand}` : ''}${location ? ` / ${location}` : ''}`);
      }
    }

    this.appendMemorySection(lines, '### 企业记忆', input.enterpriseMemory);
    this.appendMemorySection(lines, '### 群聊记忆', input.conversationMemory);
    this.appendMemorySection(lines, '### 个人记忆', input.employeeMemory);

    if (input.browserProfiles.length > 0) {
      lines.push('', '### 可用浏览器登录态能力');
      for (const profile of input.browserProfiles) {
        lines.push(`- ${profile.label} / ${profile.platform} / 状态:${profile.status} / 风险:${profile.risk_level} / 最高动作:${profile.allowed_action_level}`);
      }
      lines.push('浏览器登录态只作为内部工具能力引用，不包含 cookie、token、密码、验证码或 storage state 内容。');
    }

    return lines.length > 1 ? lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  }

  private appendMemorySection(lines: string[], title: string, memories: AdminMemoryItem[]): void {
    if (memories.length === 0) {
      return;
    }

    lines.push('', title);
    for (const memory of memories.slice(0, 20)) {
      const label = memory.category ? `[${memory.category}] ` : '';
      lines.push(`- ${label}${memory.content}`);
    }
  }
}

