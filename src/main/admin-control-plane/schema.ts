import type Database from '../../shared/utils/sqlite-adapter';

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

export function initAdminControlPlaneTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      city TEXT,
      area TEXT,
      platform_store_id TEXT,
      aliases TEXT,
      status TEXT NOT NULL DEFAULT 'operating',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 添加 aliases 字段（如果不存在）
  ensureColumn(db, 'stores', 'aliases', 'aliases TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      open_id TEXT,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      status TEXT NOT NULL DEFAULT 'active',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(connector_id, user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS feishu_conversations (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      default_task_categories_json TEXT NOT NULL DEFAULT '[]',
      default_ttl_days INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(connector_id, conversation_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_assignments (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      responsibility TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(store_id, employee_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_store_bindings (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(conversation_id, store_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_accounts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      label TEXT NOT NULL,
      store_id TEXT,
      account_ref TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      risk_account_class TEXT NOT NULL DEFAULT 'standard',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  ensureColumn(db, 'platform_accounts', 'risk_account_class', `risk_account_class TEXT NOT NULL DEFAULT 'standard'`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_login_requests (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      requester_open_id TEXT,
      employee_id TEXT,
      store_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_account_id TEXT,
      browser_profile_id TEXT,
      browser_act_browser_id TEXT,
      session_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      login_url TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      verified_at INTEGER,
      failed_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      label TEXT NOT NULL,
      store_id TEXT,
      profile_path TEXT,
      storage_state_ref TEXT,
      status TEXT NOT NULL DEFAULT 'healthy',
      risk_level TEXT NOT NULL DEFAULT 'medium',
      allowed_action_level TEXT NOT NULL DEFAULT 'read_only',
      last_checked_at INTEGER,
      last_successful_use_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_profile_permissions (
      id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action_level TEXT NOT NULL DEFAULT 'read_only',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(browser_profile_id, entity_type, entity_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_profile_health_checks (
      id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      checked_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'mem0',
      provider_memory_id TEXT,
      scope TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      confidence REAL NOT NULL DEFAULT 0.5,
      expires_at INTEGER,
      created_by TEXT,
      approved_by TEXT,
      last_used_at INTEGER,
      supersedes_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entity_links (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(memory_id, entity_type, entity_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_reviews (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      reviewer_id TEXT,
      decision TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_provider_sync (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_memory_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(memory_id, provider)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_policies (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action_level TEXT NOT NULL,
      requires_confirmation INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(entity_type, entity_id, action_level)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      risk_level TEXT NOT NULL DEFAULT 'low',
      changes_json TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feishu_conversations_status ON feishu_conversations(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_store_assignments_store ON store_assignments(store_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_store_assignments_employee ON store_assignments(employee_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_store_bindings_conversation ON conversation_store_bindings(conversation_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_store_bindings_store ON conversation_store_bindings(store_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_accounts_store ON platform_accounts(store_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_login_requests_requester ON browser_login_requests(connector_id, requester_user_id, status, expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_login_requests_store ON browser_login_requests(store_id, status, expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_profiles_store ON browser_profiles(store_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_items_status_scope ON memory_items(status, scope)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_entity_links_entity ON memory_entity_links(entity_type, entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_provider_sync_memory ON memory_provider_sync(memory_id, provider)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id, created_at)`);
}
