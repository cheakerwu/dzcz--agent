import { randomBytes } from 'node:crypto';
import type Database from '../../shared/utils/sqlite-adapter';
import { safeJsonParse, safeJsonStringify } from '../../shared/utils/json-utils';
import type {
  AdminAuditEvent,
  AdminBrowserProfile,
  AdminDashboard,
  AdminEmployee,
  AdminFeishuConversation,
  AdminMemoryItem,
  AdminProviderSyncState,
  AdminStore,
  AssignmentStatus,
  AssignEmployeeToStoreInput,
  BindConversationToStoreInput,
  BrowserActionLevel,
  BrowserProfilePermission,
  ConversationStoreBinding,
  CreateBrowserProfileInput,
  CreateMemoryItemInput,
  CreateStoreInput,
  GrantBrowserProfilePermissionInput,
  ListAuditEventsFilter,
  ListMemoryItemsFilter,
  MemoryEntityLinkInput,
  MemoryStatus,
  ProviderSyncStatus,
  RiskLevel,
  StoreAssignment,
  UpsertEmployeeInput,
  UpsertFeishuConversationInput,
} from '../../types/admin-control-plane';
import { initAdminControlPlaneTables } from './schema';
import type { Mem0MemoryProvider } from './mem0-provider';
import { OptionalMem0Provider } from './mem0-provider';

type Row = Record<string, any>;

function now(): number {
  return Date.now();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapStore(row: Row): AdminStore {
  return {
    id: row.id,
    name: row.name,
    brand: optionalString(row.brand),
    city: optionalString(row.city),
    area: optionalString(row.area),
    platformStoreId: optionalString(row.platform_store_id),
    status: row.status,
    notes: optionalString(row.notes),
    activeMemoryCount: Number(row.active_memory_count || 0),
    staleMemoryCount: Number(row.stale_memory_count || 0),
    lastMemoryUpdateAt: row.last_memory_update_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEmployee(row: Row): AdminEmployee {
  return {
    id: row.id,
    connectorId: row.connector_id,
    userId: row.user_id,
    openId: optionalString(row.open_id),
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversation(row: Row, boundStoreIds: string[] = []): AdminFeishuConversation {
  return {
    id: row.id,
    connectorId: row.connector_id,
    conversationId: row.conversation_id,
    chatType: row.chat_type,
    name: optionalString(row.name),
    status: row.status,
    defaultTaskCategories: safeJsonParse(row.default_task_categories_json, []),
    defaultTtlDays: row.default_ttl_days ?? undefined,
    boundStoreIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: Row): StoreAssignment {
  return {
    id: row.id,
    storeId: row.store_id,
    employeeId: row.employee_id,
    responsibility: row.responsibility,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: Row): ConversationStoreBinding {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    storeId: row.store_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBrowserProfile(row: Row): AdminBrowserProfile {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    storeId: optionalString(row.store_id),
    profilePath: optionalString(row.profile_path),
    storageStateRef: optionalString(row.storage_state_ref),
    status: row.status,
    riskLevel: row.risk_level,
    allowedActionLevel: row.allowed_action_level,
    lastCheckedAt: row.last_checked_at ?? undefined,
    lastSuccessfulUseAt: row.last_successful_use_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProviderSync(row: Row | undefined): AdminProviderSyncState | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    memoryId: row.memory_id,
    provider: row.provider,
    providerMemoryId: optionalString(row.provider_memory_id),
    status: row.status,
    error: optionalString(row.error),
    lastSyncedAt: row.last_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: Row, entityLinks: MemoryEntityLinkInput[] = [], sync?: AdminProviderSyncState): AdminMemoryItem {
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
    entityLinks,
    providerSync: sync,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: Row): AdminAuditEvent {
  return {
    id: row.id,
    actorId: optionalString(row.actor_id),
    action: row.action,
    entityType: row.entity_type,
    entityId: optionalString(row.entity_id),
    riskLevel: row.risk_level,
    changes: row.changes_json ? safeJsonParse(row.changes_json, {}) : undefined,
    createdAt: row.created_at,
  };
}

export class AdminControlPlaneService {
  private readonly mem0Provider: Mem0MemoryProvider;

  constructor(private readonly db: Database.Database, mem0Provider?: Mem0MemoryProvider) {
    this.mem0Provider = mem0Provider || new OptionalMem0Provider({ enabled: false });
  }

  ensureSchema(): void {
    initAdminControlPlaneTables(this.db);
  }

  getDashboard(): AdminDashboard {
    this.ensureSchema();
    const counts = {
      stores: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM stores WHERE status != 'closed'`).get() as Row).count),
      activeConversations: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM feishu_conversations WHERE status = 'active'`).get() as Row).count),
      activeEmployees: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM employees WHERE status = 'active'`).get() as Row).count),
      activeMemoryItems: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM memory_items WHERE status = 'active'`).get() as Row).count),
      pendingMemoryReviews: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM memory_items WHERE status IN ('candidate', 'pending_review')`).get() as Row).count),
      browserProfilesNeedingAttention: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM browser_profiles WHERE status IN ('needs_reauth', 'expired', 'revoked', 'locked', 'unhealthy')`).get() as Row).count),
    };

    const unboundRows = this.db.prepare(`
      SELECT c.* FROM feishu_conversations c
      LEFT JOIN conversation_store_bindings b ON b.conversation_id = c.id AND b.status = 'active'
      WHERE c.status = 'active' AND b.id IS NULL
      ORDER BY c.updated_at DESC
      LIMIT 20
    `).all() as Row[];

    return {
      counts,
      unboundConversations: unboundRows.map((row) => mapConversation(row, [])),
      pendingMemoryItems: this.listMemoryItems({ status: 'pending_review' }).slice(0, 20),
      unhealthyBrowserProfiles: this.listBrowserProfiles().filter((profile) =>
        ['needs_reauth', 'expired', 'revoked', 'locked', 'unhealthy'].includes(profile.status)
      ).slice(0, 20),
      recentAuditEvents: this.listAuditEvents({ limit: 20 }),
    };
  }

  createStore(input: CreateStoreInput, actorId = 'system'): AdminStore {
    this.ensureSchema();
    const timestamp = now();
    const id = createId('store');
    this.db.prepare(`
      INSERT INTO stores (id, name, brand, city, area, platform_store_id, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name.trim(),
      input.brand ?? null,
      input.city ?? null,
      input.area ?? null,
      input.platformStoreId ?? null,
      input.status || 'operating',
      input.notes ?? null,
      timestamp,
      timestamp
    );
    this.recordAuditEvent(actorId, 'store.created', 'store', id, input, 'medium');
    return this.getStore(id);
  }

  listStores(): AdminStore[] {
    this.ensureSchema();
    const rows = this.db.prepare(`
      SELECT
        s.*,
        COUNT(CASE WHEN mi.status = 'active' THEN 1 END) AS active_memory_count,
        COUNT(CASE WHEN mi.status = 'expired' THEN 1 END) AS stale_memory_count,
        MAX(mi.updated_at) AS last_memory_update_at
      FROM stores s
      LEFT JOIN memory_entity_links mel ON mel.entity_type = 'store' AND mel.entity_id = s.id
      LEFT JOIN memory_items mi ON mi.id = mel.memory_id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all() as Row[];
    return rows.map(mapStore);
  }

  updateStore(id: string, input: Partial<CreateStoreInput>, actorId = 'system'): AdminStore {
    this.ensureSchema();
    const current = this.getStore(id);
    const next = {
      name: input.name ?? current.name,
      brand: input.brand ?? current.brand ?? null,
      city: input.city ?? current.city ?? null,
      area: input.area ?? current.area ?? null,
      platformStoreId: input.platformStoreId ?? current.platformStoreId ?? null,
      status: input.status ?? current.status,
      notes: input.notes ?? current.notes ?? null,
    };
    this.db.prepare(`
      UPDATE stores
      SET name = ?, brand = ?, city = ?, area = ?, platform_store_id = ?, status = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.brand, next.city, next.area, next.platformStoreId, next.status, next.notes, now(), id);
    this.recordAuditEvent(actorId, 'store.updated', 'store', id, input, 'medium');
    return this.getStore(id);
  }

  upsertEmployee(input: UpsertEmployeeInput, actorId = 'system'): AdminEmployee {
    this.ensureSchema();
    const existing = this.db.prepare(`
      SELECT * FROM employees WHERE connector_id = ? AND user_id = ?
    `).get(input.connectorId, input.userId) as Row | undefined;
    const timestamp = now();
    const role = input.role || (input.isAdmin ? 'admin' : 'operator');
    const status = input.status || 'active';

    if (existing) {
      this.db.prepare(`
        UPDATE employees
        SET open_id = ?, display_name = ?, role = ?, status = ?, is_admin = ?, updated_at = ?
        WHERE id = ?
      `).run(input.openId ?? null, input.displayName, role, status, input.isAdmin ? 1 : 0, timestamp, existing.id);
      this.recordAuditEvent(actorId, 'employee.updated', 'employee', existing.id, input, 'medium');
      return this.getEmployee(existing.id);
    }

    const id = createId('emp');
    this.db.prepare(`
      INSERT INTO employees (id, connector_id, user_id, open_id, display_name, role, status, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.connectorId, input.userId, input.openId ?? null, input.displayName, role, status, input.isAdmin ? 1 : 0, timestamp, timestamp);
    this.recordAuditEvent(actorId, 'employee.created', 'employee', id, input, 'medium');
    return this.getEmployee(id);
  }

  listEmployees(): AdminEmployee[] {
    this.ensureSchema();
    return (this.db.prepare(`SELECT * FROM employees ORDER BY updated_at DESC`).all() as Row[]).map(mapEmployee);
  }

  offboardEmployee(employeeId: string, actorId = 'system'): void {
    this.ensureSchema();
    const timestamp = now();
    this.db.prepare(`UPDATE employees SET status = 'offboarded', updated_at = ? WHERE id = ?`).run(timestamp, employeeId);
    this.db.prepare(`UPDATE store_assignments SET status = 'revoked', updated_at = ? WHERE employee_id = ?`).run(timestamp, employeeId);
    this.db.prepare(`
      UPDATE browser_profile_permissions
      SET status = 'revoked', updated_at = ?
      WHERE entity_type = 'employee' AND entity_id = ?
    `).run(timestamp, employeeId);
    this.recordAuditEvent(actorId, 'employee.offboarded', 'employee', employeeId, { revokedAt: timestamp }, 'high');
  }

  upsertFeishuConversation(input: UpsertFeishuConversationInput, actorId = 'system'): AdminFeishuConversation {
    this.ensureSchema();
    const existing = this.db.prepare(`
      SELECT * FROM feishu_conversations WHERE connector_id = ? AND conversation_id = ?
    `).get(input.connectorId, input.conversationId) as Row | undefined;
    const timestamp = now();
    const categoriesJson = safeJsonStringify(input.defaultTaskCategories || []);

    if (existing) {
      this.db.prepare(`
        UPDATE feishu_conversations
        SET chat_type = ?, name = ?, status = ?, default_task_categories_json = ?, default_ttl_days = ?, updated_at = ?
        WHERE id = ?
      `).run(input.chatType, input.name ?? null, input.status || 'active', categoriesJson, input.defaultTtlDays ?? null, timestamp, existing.id);
      this.recordAuditEvent(actorId, 'conversation.updated', 'conversation', existing.id, input, 'medium');
      return this.getConversation(existing.id);
    }

    const id = createId('conv');
    this.db.prepare(`
      INSERT INTO feishu_conversations (id, connector_id, conversation_id, chat_type, name, status, default_task_categories_json, default_ttl_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.connectorId, input.conversationId, input.chatType, input.name ?? null, input.status || 'active', categoriesJson, input.defaultTtlDays ?? null, timestamp, timestamp);
    this.recordAuditEvent(actorId, 'conversation.created', 'conversation', id, input, 'medium');
    return this.getConversation(id);
  }

  listFeishuConversations(): AdminFeishuConversation[] {
    this.ensureSchema();
    const rows = this.db.prepare(`SELECT * FROM feishu_conversations ORDER BY updated_at DESC`).all() as Row[];
    return rows.map((row) => mapConversation(row, this.getBoundStoreIds(row.id)));
  }

  bindConversationToStore(input: BindConversationToStoreInput, actorId = 'system'): ConversationStoreBinding {
    this.ensureSchema();
    const timestamp = now();
    const existing = this.db.prepare(`
      SELECT * FROM conversation_store_bindings WHERE conversation_id = ? AND store_id = ?
    `).get(input.conversationId, input.storeId) as Row | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE conversation_store_bindings SET status = 'active', updated_at = ? WHERE id = ?
      `).run(timestamp, existing.id);
      this.recordAuditEvent(actorId, 'conversation_store_binding.updated', 'conversation', input.conversationId, input, 'medium');
      return mapBinding({ ...existing, status: 'active', updated_at: timestamp });
    }

    const id = createId('bind');
    this.db.prepare(`
      INSERT INTO conversation_store_bindings (id, conversation_id, store_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(id, input.conversationId, input.storeId, timestamp, timestamp);
    this.recordAuditEvent(actorId, 'conversation_store_binding.created', 'conversation', input.conversationId, input, 'medium');
    return mapBinding(this.db.prepare(`SELECT * FROM conversation_store_bindings WHERE id = ?`).get(id) as Row);
  }

  assignEmployeeToStore(input: AssignEmployeeToStoreInput, actorId = 'system'): StoreAssignment {
    this.ensureSchema();
    const timestamp = now();
    const existing = this.db.prepare(`
      SELECT * FROM store_assignments WHERE store_id = ? AND employee_id = ?
    `).get(input.storeId, input.employeeId) as Row | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE store_assignments SET responsibility = ?, status = 'active', updated_at = ? WHERE id = ?
      `).run(input.responsibility || 'owner', timestamp, existing.id);
      this.recordAuditEvent(actorId, 'store_assignment.updated', 'store', input.storeId, input, 'medium');
      return mapAssignment({ ...existing, responsibility: input.responsibility || 'owner', status: 'active', updated_at: timestamp });
    }

    const id = createId('asg');
    this.db.prepare(`
      INSERT INTO store_assignments (id, store_id, employee_id, responsibility, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, input.storeId, input.employeeId, input.responsibility || 'owner', timestamp, timestamp);
    this.recordAuditEvent(actorId, 'store_assignment.created', 'store', input.storeId, input, 'medium');
    return mapAssignment(this.db.prepare(`SELECT * FROM store_assignments WHERE id = ?`).get(id) as Row);
  }

  createMemoryItem(input: CreateMemoryItemInput, actorId = 'system'): AdminMemoryItem {
    this.ensureSchema();
    const timestamp = now();
    const id = createId('mem');
    const provider = input.provider || 'mem0';
    const status = input.status || 'pending_review';
    this.db.prepare(`
      INSERT INTO memory_items (
        id, provider, provider_memory_id, scope, category, content, status, confidence, expires_at,
        created_by, approved_by, supersedes_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      provider,
      input.providerMemoryId ?? null,
      input.scope,
      input.category ?? null,
      input.content,
      status,
      input.confidence ?? 0.5,
      input.expiresAt ?? null,
      input.createdBy || actorId,
      input.approvedBy ?? (status === 'active' ? actorId : null),
      input.supersedesId ?? null,
      timestamp,
      timestamp
    );

    this.db.prepare(`
      INSERT INTO memory_versions (id, memory_id, content, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(createId('memver'), id, input.content, status, actorId, timestamp);

    this.upsertProviderSync(id, provider, input.providerMemoryId, input.providerMemoryId ? 'synced' : 'pending', undefined);

    for (const link of input.entityLinks || []) {
      this.addMemoryEntityLink(id, link);
    }

    if (input.sourceType) {
      this.db.prepare(`
        INSERT INTO memory_sources (id, memory_id, source_type, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(createId('memsrc'), id, input.sourceType, input.sourceRef ?? null, timestamp);
    }

    this.recordAuditEvent(actorId, 'memory.created', 'memory', id, { scope: input.scope, status }, status === 'active' ? 'medium' : 'low');
    return this.getMemoryItem(id);
  }

  listMemoryItems(filter: ListMemoryItemsFilter = {}): AdminMemoryItem[] {
    this.ensureSchema();
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.scope) {
      clauses.push('mi.scope = ?');
      params.push(filter.scope);
    }
    if (filter.status) {
      clauses.push('mi.status = ?');
      params.push(filter.status);
    }
    if (filter.category) {
      clauses.push('mi.category = ?');
      params.push(filter.category);
    }
    if (filter.storeId || filter.employeeId || filter.conversationId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM memory_entity_links mel
        WHERE mel.memory_id = mi.id AND mel.entity_type = ? AND mel.entity_id = ?
      )`);
      if (filter.storeId) {
        params.push('store', filter.storeId);
      } else if (filter.employeeId) {
        params.push('employee', filter.employeeId);
      } else {
        params.push('conversation', filter.conversationId);
      }
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT mi.* FROM memory_items mi
      ${where}
      ORDER BY mi.updated_at DESC
    `).all(...params) as Row[];
    return rows.map((row) => this.mapMemoryWithRelations(row));
  }

  updateMemoryStatus(id: string, status: MemoryStatus, actorId = 'system'): AdminMemoryItem {
    this.ensureSchema();
    this.db.prepare(`UPDATE memory_items SET status = ?, approved_by = COALESCE(approved_by, ?), updated_at = ? WHERE id = ?`)
      .run(status, status === 'active' ? actorId : null, now(), id);
    this.recordAuditEvent(actorId, 'memory.status_updated', 'memory', id, { status }, 'medium');
    return this.getMemoryItem(id);
  }

  createBrowserProfile(input: CreateBrowserProfileInput, actorId = 'system'): AdminBrowserProfile {
    this.ensureSchema();
    const timestamp = now();
    const id = createId('browser');
    this.db.prepare(`
      INSERT INTO browser_profiles (
        id, platform, label, store_id, profile_path, storage_state_ref, status, risk_level,
        allowed_action_level, last_checked_at, last_successful_use_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.platform,
      input.label,
      input.storeId ?? null,
      input.profilePath ?? null,
      input.storageStateRef ?? null,
      input.status || 'healthy',
      input.riskLevel || 'medium',
      input.allowedActionLevel || 'read_only',
      input.lastCheckedAt ?? null,
      input.lastSuccessfulUseAt ?? null,
      timestamp,
      timestamp
    );
    this.recordAuditEvent(actorId, 'browser_profile.created', 'browser_profile', id, {
      platform: input.platform,
      label: input.label,
      storeId: input.storeId,
      status: input.status || 'healthy',
    }, input.riskLevel === 'high' ? 'high' : 'medium');
    return this.getBrowserProfile(id);
  }

  listBrowserProfiles(): AdminBrowserProfile[] {
    this.ensureSchema();
    return (this.db.prepare(`SELECT * FROM browser_profiles ORDER BY updated_at DESC`).all() as Row[]).map(mapBrowserProfile);
  }

  grantBrowserProfilePermission(input: GrantBrowserProfilePermissionInput, actorId = 'system'): BrowserProfilePermission {
    this.ensureSchema();
    const timestamp = now();
    const existing = this.db.prepare(`
      SELECT * FROM browser_profile_permissions
      WHERE browser_profile_id = ? AND entity_type = ? AND entity_id = ?
    `).get(input.browserProfileId, input.entityType, input.entityId) as Row | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE browser_profile_permissions SET action_level = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(input.actionLevel || 'read_only', input.status || 'active', timestamp, existing.id);
      this.recordAuditEvent(actorId, 'browser_profile_permission.updated', 'browser_profile', input.browserProfileId, input, 'high');
      return this.getBrowserProfilePermission(existing.id);
    }

    const id = createId('bperm');
    this.db.prepare(`
      INSERT INTO browser_profile_permissions (id, browser_profile_id, entity_type, entity_id, action_level, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.browserProfileId, input.entityType, input.entityId, input.actionLevel || 'read_only', input.status || 'active', timestamp, timestamp);
    this.recordAuditEvent(actorId, 'browser_profile_permission.created', 'browser_profile', input.browserProfileId, input, 'high');
    return this.getBrowserProfilePermission(id);
  }

  listAuditEvents(filter: ListAuditEventsFilter = {}): AdminAuditEvent[] {
    this.ensureSchema();
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.entityType) {
      clauses.push('entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.entityId) {
      clauses.push('entity_id = ?');
      params.push(filter.entityId);
    }
    if (filter.actorId) {
      clauses.push('actor_id = ?');
      params.push(filter.actorId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(filter.limit || 100, 500));
    return (this.db.prepare(`
      SELECT * FROM audit_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `).all(...params) as Row[]).map(mapAudit);
  }

  buildPromptContextForConnectorSession(input: { connectorId: string; conversationId: string }): string {
    this.ensureSchema();
    const conversation = this.db.prepare(`
      SELECT * FROM feishu_conversations WHERE connector_id = ? AND conversation_id = ? AND status = 'active'
    `).get(input.connectorId, input.conversationId) as Row | undefined;
    if (!conversation) {
      return '';
    }

    const storeRows = this.db.prepare(`
      SELECT s.* FROM stores s
      JOIN conversation_store_bindings b ON b.store_id = s.id
      WHERE b.conversation_id = ? AND b.status = 'active' AND s.status != 'closed'
      ORDER BY s.name ASC
    `).all(conversation.id) as Row[];
    const stores = storeRows.map(mapStore);
    const storeIds = stores.map((store) => store.id);
    const memoryItems = this.getPromptMemoryItems(conversation.id, storeIds);
    const browserProfiles = storeIds.length > 0
      ? this.db.prepare(`
          SELECT * FROM browser_profiles
          WHERE store_id IN (${storeIds.map(() => '?').join(',')})
            AND status IN ('healthy', 'needs_reauth')
          ORDER BY platform ASC, label ASC
        `).all(...storeIds) as Row[]
      : [];

    const lines: string[] = [];
    lines.push(`会话: ${conversation.name || conversation.conversation_id} (${conversation.chat_type})`);

    if (stores.length > 0) {
      lines.push('关联门店:');
      for (const store of stores) {
        const location = [store.city, store.area].filter(Boolean).join(' ');
        lines.push(`- ${store.name}${store.brand ? ` / ${store.brand}` : ''}${location ? ` / ${location}` : ''}`);
      }
    }

    if (memoryItems.length > 0) {
      lines.push('可用运营记忆:');
      for (const memory of memoryItems.slice(0, 20)) {
        lines.push(`- [${memory.scope}${memory.category ? `:${memory.category}` : ''}] ${memory.content}`);
      }
    }

    if (browserProfiles.length > 0) {
      lines.push('可用浏览器登录态能力引用:');
      for (const profile of browserProfiles.map(mapBrowserProfile)) {
        lines.push(`- ${profile.label} / ${profile.platform} / 状态:${profile.status} / 风险:${profile.riskLevel} / 最高动作:${profile.allowedActionLevel}`);
      }
      lines.push('浏览器登录态只作为内部工具能力引用，不包含 cookie、token、密码、验证码或 storage state 内容。');
    }

    return lines.length > 1 ? lines.join('\n') : '';
  }

  async syncMemoryItemToProvider(memoryId: string, actorId = 'system'): Promise<AdminMemoryItem> {
    this.ensureSchema();
    const memory = this.getMemoryItem(memoryId);
    const result = await this.mem0Provider.addMemory({
      id: memory.id,
      content: memory.content,
      scope: memory.scope,
      metadata: {
        category: memory.category,
        status: memory.status,
        entityLinks: memory.entityLinks,
      },
    });
    this.upsertProviderSync(
      memory.id,
      'mem0',
      result.providerMemoryId,
      result.status,
      result.error
    );
    if (result.providerMemoryId) {
      this.db.prepare(`UPDATE memory_items SET provider = 'mem0', provider_memory_id = ?, updated_at = ? WHERE id = ?`)
        .run(result.providerMemoryId, now(), memory.id);
    }
    this.recordAuditEvent(actorId, 'memory.provider_synced', 'memory', memory.id, result, result.status === 'error' ? 'medium' : 'low');
    return this.getMemoryItem(memory.id);
  }

  private getStore(id: string): AdminStore {
    const found = this.listStores().find((store) => store.id === id);
    if (!found) throw new Error(`Store not found: ${id}`);
    return found;
  }

  private getEmployee(id: string): AdminEmployee {
    const row = this.db.prepare(`SELECT * FROM employees WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Employee not found: ${id}`);
    return mapEmployee(row);
  }

  private getConversation(id: string): AdminFeishuConversation {
    const row = this.db.prepare(`SELECT * FROM feishu_conversations WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Conversation not found: ${id}`);
    return mapConversation(row, this.getBoundStoreIds(id));
  }

  private getBrowserProfile(id: string): AdminBrowserProfile {
    const row = this.db.prepare(`SELECT * FROM browser_profiles WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Browser profile not found: ${id}`);
    return mapBrowserProfile(row);
  }

  private getBrowserProfilePermission(id: string): BrowserProfilePermission {
    const row = this.db.prepare(`SELECT * FROM browser_profile_permissions WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Browser profile permission not found: ${id}`);
    return {
      id: row.id,
      browserProfileId: row.browser_profile_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actionLevel: row.action_level,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getMemoryItem(id: string): AdminMemoryItem {
    const row = this.db.prepare(`SELECT * FROM memory_items WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Memory item not found: ${id}`);
    return this.mapMemoryWithRelations(row);
  }

  private mapMemoryWithRelations(row: Row): AdminMemoryItem {
    const links = (this.db.prepare(`
      SELECT entity_type, entity_id FROM memory_entity_links WHERE memory_id = ? ORDER BY created_at ASC
    `).all(row.id) as Row[]).map((link) => ({
      entityType: link.entity_type,
      entityId: link.entity_id,
    }));
    const sync = this.db.prepare(`
      SELECT * FROM memory_provider_sync WHERE memory_id = ? AND provider = ?
    `).get(row.id, row.provider || 'mem0') as Row | undefined;
    return mapMemory(row, links, mapProviderSync(sync));
  }

  private addMemoryEntityLink(memoryId: string, link: MemoryEntityLinkInput): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_entity_links (id, memory_id, entity_type, entity_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(createId('memlink'), memoryId, link.entityType, link.entityId, now());
  }

  private getBoundStoreIds(conversationId: string): string[] {
    return (this.db.prepare(`
      SELECT store_id FROM conversation_store_bindings
      WHERE conversation_id = ? AND status = 'active'
      ORDER BY created_at ASC
    `).all(conversationId) as Row[]).map((row) => row.store_id);
  }

  private getPromptMemoryItems(conversationId: string, storeIds: string[]): AdminMemoryItem[] {
    const params: any[] = ['conversation', conversationId];
    const entityClauses = [`(mel.entity_type = ? AND mel.entity_id = ?)`];
    for (const storeId of storeIds) {
      entityClauses.push(`(mel.entity_type = ? AND mel.entity_id = ?)`);
      params.push('store', storeId);
    }
    const rows = this.db.prepare(`
      SELECT DISTINCT mi.* FROM memory_items mi
      LEFT JOIN memory_entity_links mel ON mel.memory_id = mi.id
      WHERE mi.status = 'active'
        AND (
          mi.scope = 'enterprise'
          OR ${entityClauses.join(' OR ')}
        )
      ORDER BY mi.confidence DESC, mi.updated_at DESC
      LIMIT 40
    `).all(...params) as Row[];
    return rows.map((row) => this.mapMemoryWithRelations(row));
  }

  private upsertProviderSync(
    memoryId: string,
    provider: string,
    providerMemoryId: string | undefined,
    status: ProviderSyncStatus,
    error: string | undefined
  ): void {
    const timestamp = now();
    const existing = this.db.prepare(`
      SELECT * FROM memory_provider_sync WHERE memory_id = ? AND provider = ?
    `).get(memoryId, provider) as Row | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE memory_provider_sync
        SET provider_memory_id = ?, status = ?, error = ?, last_synced_at = ?, updated_at = ?
        WHERE id = ?
      `).run(providerMemoryId ?? existing.provider_memory_id ?? null, status, error ?? null, status === 'synced' ? timestamp : existing.last_synced_at ?? null, timestamp, existing.id);
      return;
    }

    this.db.prepare(`
      INSERT INTO memory_provider_sync (id, memory_id, provider, provider_memory_id, status, error, last_synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId('sync'), memoryId, provider, providerMemoryId ?? null, status, error ?? null, status === 'synced' ? timestamp : null, timestamp, timestamp);
  }

  private recordAuditEvent(
    actorId: string | undefined,
    action: string,
    entityType: string,
    entityId: string | undefined,
    changes: unknown,
    riskLevel: RiskLevel
  ): void {
    this.db.prepare(`
      INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, risk_level, changes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId('audit'),
      actorId ?? null,
      action,
      entityType,
      entityId ?? null,
      riskLevel,
      changes ? safeJsonStringify(changes) : null,
      now()
    );
  }
}
