import type Database from '../../../shared/utils/sqlite-adapter';
import type {
  MemoryReadPolicyInput,
  PolicyDecision,
  RuntimeMemoryScope,
} from '../../../types/admin-control-plane';
import { initAdminControlPlaneTables } from './schema';

type Row = Record<string, any>;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function deny(reason: string): PolicyDecision {
  return {
    effect: 'deny',
    reason,
    allowedStoreIds: [],
    allowedMemoryScopes: [],
    allowedBrowserProfileIds: [],
  };
}

export class PolicyService {
  constructor(private readonly db: Database.Database) {}

  evaluateMemoryRead(input: MemoryReadPolicyInput): PolicyDecision {
    initAdminControlPlaneTables(this.db);

    if (!input.conversationId) {
      return deny('Missing conversation ID.');
    }

    const conversation = this.db.prepare(`
      SELECT * FROM feishu_conversations
      WHERE connector_id = ? AND conversation_id = ? AND status = 'active'
    `).get(input.connectorId, input.conversationId) as Row | undefined;

    if (!conversation) {
      return deny('Conversation is unknown or inactive.');
    }

    const allowedStoreIds = (this.db.prepare(`
      SELECT b.store_id FROM conversation_store_bindings b
      JOIN stores s ON s.id = b.store_id
      WHERE b.conversation_id = ?
        AND b.status = 'active'
        AND s.status != 'closed'
      ORDER BY b.created_at ASC
    `).all(conversation.id) as Row[]).map((row) => row.store_id as string);

    const actor = this.resolveActiveActor(input, conversation.connector_id);
    const allowedMemoryScopes: RuntimeMemoryScope[] = ['enterprise', 'conversation'];
    if (actor) {
      allowedMemoryScopes.push('employee');
    }

    const allowedBrowserProfileIds = this.resolveBrowserProfileIds(allowedStoreIds);

    return {
      effect: 'allow',
      reason: actor
        ? 'Active conversation and active actor resolved.'
        : 'Active conversation resolved; personal memory is not available without an active actor.',
      companyId: optionalString(conversation.company_id) || 'company_default',
      actorEmployeeId: actor?.id,
      conversationInternalId: conversation.id,
      allowedStoreIds,
      allowedMemoryScopes,
      allowedBrowserProfileIds,
    };
  }

  private resolveActiveActor(input: MemoryReadPolicyInput, connectorId: string): Row | undefined {
    if (input.actorEmployeeId) {
      return this.db.prepare(`
        SELECT * FROM employees
        WHERE id = ? AND connector_id = ? AND status = 'active'
      `).get(input.actorEmployeeId, connectorId) as Row | undefined;
    }

    if (!input.actorUserId) {
      return undefined;
    }

    return this.db.prepare(`
      SELECT * FROM employees
      WHERE connector_id = ?
        AND status = 'active'
        AND (user_id = ? OR open_id = ?)
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(input.connectorId, input.actorUserId, input.actorUserId) as Row | undefined;
  }

  private resolveBrowserProfileIds(storeIds: string[]): string[] {
    if (storeIds.length === 0) {
      return [];
    }

    return (this.db.prepare(`
      SELECT id FROM browser_profiles
      WHERE store_id IN (${storeIds.map(() => '?').join(',')})
        AND status IN ('healthy', 'needs_reauth')
      ORDER BY platform ASC, label ASC
    `).all(...storeIds) as Row[]).map((row) => row.id as string);
  }
}

