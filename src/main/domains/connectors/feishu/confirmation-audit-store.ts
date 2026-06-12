import { randomBytes } from 'node:crypto';
import type Database from '../../../../shared/utils/sqlite-adapter';
import { safeJsonParse, safeJsonStringify } from '../../../../shared/utils/json-utils';
import type {
  FeishuConfirmationDecisionInput,
  FeishuConfirmationExecutionStatus,
  FeishuConfirmationPlan,
  FeishuConfirmationPlanInput,
  FeishuConfirmationRiskLevel,
  FeishuConfirmationStatus,
} from './confirmation-card';

type Row = Record<string, any>;

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function now(): number {
  return Date.now();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function riskLevelForConfirmation(riskLevel: FeishuConfirmationRiskLevel): 'low' | 'medium' | 'high' | 'critical' {
  return riskLevel;
}

function mapPlan(row: Row): FeishuConfirmationPlan {
  return {
    planId: row.plan_id,
    title: row.title,
    summary: row.summary,
    riskLevel: row.risk_level,
    requesterId: optionalString(row.requester_id),
    requesterName: optionalString(row.requester_name),
    conversationId: optionalString(row.conversation_id),
    messageId: optionalString(row.message_id),
    details: safeJsonParse(row.details_json, {}),
    executionBinding: safeJsonParse(row.execution_binding_json, undefined),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    status: row.status,
    approvedById: optionalString(row.approved_by_id),
    approvedByName: optionalString(row.approved_by_name),
    approvedAt: row.approved_at ?? undefined,
    rejectedById: optionalString(row.rejected_by_id),
    rejectedByName: optionalString(row.rejected_by_name),
    rejectedAt: row.rejected_at ?? undefined,
    executionStatus: optionalString(row.execution_status) as FeishuConfirmationExecutionStatus | undefined,
    executionToolName: optionalString(row.execution_tool_name),
    executionExitCode: row.execution_exit_code ?? undefined,
    executionError: optionalString(row.execution_error),
    executionArtifacts: safeJsonParse(row.execution_artifacts_json, []),
    executionStdoutPreview: optionalString(row.execution_stdout_preview),
    executionStderrPreview: optionalString(row.execution_stderr_preview),
    executedAt: row.executed_at ?? undefined,
  };
}

export interface FeishuConfirmationAuditListFilter {
  status?: FeishuConfirmationStatus;
  conversationId?: string;
  requesterId?: string;
  limit?: number;
}

export interface FeishuConfirmationExecutionResultInput {
  status: FeishuConfirmationExecutionStatus;
  toolName: string;
  exitCode?: number | null;
  error?: string;
  artifacts?: string[];
  stdoutPreview?: string;
  stderrPreview?: string;
  executedAt?: number;
}

export class FeishuConfirmationAuditStore {
  constructor(private readonly db: Database.Database) {}

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_confirmation_plans (
        plan_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        requester_id TEXT,
        requester_name TEXT,
        conversation_id TEXT,
        message_id TEXT,
        details_json TEXT,
        execution_binding_json TEXT,
        approved_by_id TEXT,
        approved_by_name TEXT,
        approved_at INTEGER,
        rejected_by_id TEXT,
        rejected_by_name TEXT,
        rejected_at INTEGER,
        execution_status TEXT,
        execution_tool_name TEXT,
        execution_exit_code INTEGER,
        execution_error TEXT,
        execution_artifacts_json TEXT,
        execution_stdout_preview TEXT,
        execution_stderr_preview TEXT,
        executed_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_status', 'execution_status TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_tool_name', 'execution_tool_name TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_exit_code', 'execution_exit_code INTEGER');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_error', 'execution_error TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_artifacts_json', 'execution_artifacts_json TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_stdout_preview', 'execution_stdout_preview TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'execution_stderr_preview', 'execution_stderr_preview TEXT');
    ensureColumn(this.db, 'feishu_confirmation_plans', 'executed_at', 'executed_at INTEGER');

    this.db.exec(`
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

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_feishu_confirmation_status ON feishu_confirmation_plans(status, updated_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_feishu_confirmation_conversation ON feishu_confirmation_plans(conversation_id, updated_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_feishu_confirmation_requester ON feishu_confirmation_plans(requester_id, updated_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id, created_at)`);
  }

  create(input: FeishuConfirmationPlanInput, status: FeishuConfirmationStatus = 'pending'): FeishuConfirmationPlan {
    this.ensureSchema();
    const createdAt = input.createdAt || now();
    const updatedAt = now();

    this.db.prepare(`
      INSERT INTO feishu_confirmation_plans (
        plan_id, title, summary, risk_level, status, requester_id, requester_name,
        conversation_id, message_id, details_json, execution_binding_json, expires_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.planId,
      input.title,
      input.summary,
      input.riskLevel,
      status,
      input.requesterId ?? null,
      input.requesterName ?? null,
      input.conversationId ?? null,
      input.messageId ?? null,
      safeJsonStringify(input.details || {}),
      input.executionBinding ? safeJsonStringify(input.executionBinding) : null,
      input.expiresAt ?? null,
      createdAt,
      updatedAt,
    );

    const plan = this.get(input.planId);
    this.recordAuditEvent(
      input.requesterId,
      'feishu_confirmation.created',
      plan.planId,
      plan,
      riskLevelForConfirmation(plan.riskLevel),
      createdAt,
    );
    return plan;
  }

  approve(plan: FeishuConfirmationPlan, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan {
    return this.updateDecision(plan, input, 'approved');
  }

  reject(plan: FeishuConfirmationPlan, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan {
    return this.updateDecision(plan, input, 'rejected');
  }

  recordExecutionResult(planId: string, input: FeishuConfirmationExecutionResultInput): FeishuConfirmationPlan {
    this.ensureSchema();
    const executedAt = input.executedAt || now();
    const updatedAt = now();
    this.db.prepare(`
      UPDATE feishu_confirmation_plans
      SET execution_status = ?,
          execution_tool_name = ?,
          execution_exit_code = ?,
          execution_error = ?,
          execution_artifacts_json = ?,
          execution_stdout_preview = ?,
          execution_stderr_preview = ?,
          executed_at = ?,
          updated_at = ?
      WHERE plan_id = ?
    `).run(
      input.status,
      input.toolName,
      input.exitCode ?? null,
      input.error ?? null,
      safeJsonStringify(input.artifacts || []),
      input.stdoutPreview ?? null,
      input.stderrPreview ?? null,
      executedAt,
      updatedAt,
      planId,
    );

    const updated = this.get(planId);
    this.recordAuditEvent(
      updated.approvedById || updated.requesterId,
      input.status === 'completed'
        ? 'feishu_confirmation.execution_completed'
        : 'feishu_confirmation.execution_failed',
      updated.planId,
      {
        status: input.status,
        toolName: input.toolName,
        exitCode: input.exitCode,
        error: input.error,
        artifacts: input.artifacts || [],
        stdoutPreview: input.stdoutPreview,
        stderrPreview: input.stderrPreview,
      },
      riskLevelForConfirmation(updated.riskLevel),
      executedAt,
    );
    return updated;
  }

  get(planId: string): FeishuConfirmationPlan {
    this.ensureSchema();
    const row = this.db.prepare(`SELECT * FROM feishu_confirmation_plans WHERE plan_id = ?`).get(planId) as Row | undefined;
    if (!row) {
      throw new Error(`确认计划审计记录不存在: ${planId}`);
    }
    return mapPlan(row);
  }

  list(filter: FeishuConfirmationAuditListFilter = {}): FeishuConfirmationPlan[] {
    this.ensureSchema();
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.conversationId) {
      clauses.push('conversation_id = ?');
      params.push(filter.conversationId);
    }
    if (filter.requesterId) {
      clauses.push('requester_id = ?');
      params.push(filter.requesterId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(filter.limit || 100, 500));
    return (this.db.prepare(`
      SELECT * FROM feishu_confirmation_plans
      ${where}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${limit}
    `).all(...params) as Row[]).map(mapPlan);
  }

  private updateDecision(
    plan: FeishuConfirmationPlan,
    input: FeishuConfirmationDecisionInput,
    status: 'approved' | 'rejected',
  ): FeishuConfirmationPlan {
    this.ensureSchema();
    const decidedAt = input.decidedAt || now();
    const updatedAt = now();
    const approved = status === 'approved';

    this.db.prepare(`
      UPDATE feishu_confirmation_plans
      SET status = ?,
          approved_by_id = ?,
          approved_by_name = ?,
          approved_at = ?,
          rejected_by_id = ?,
          rejected_by_name = ?,
          rejected_at = ?,
          updated_at = ?
      WHERE plan_id = ?
    `).run(
      status,
      approved ? input.operatorId : plan.approvedById ?? null,
      approved ? input.operatorName ?? null : plan.approvedByName ?? null,
      approved ? decidedAt : plan.approvedAt ?? null,
      approved ? plan.rejectedById ?? null : input.operatorId,
      approved ? plan.rejectedByName ?? null : input.operatorName ?? null,
      approved ? plan.rejectedAt ?? null : decidedAt,
      updatedAt,
      plan.planId,
    );

    const updated = this.get(plan.planId);
    this.recordAuditEvent(
      input.operatorId,
      approved ? 'feishu_confirmation.approved' : 'feishu_confirmation.rejected',
      updated.planId,
      updated,
      riskLevelForConfirmation(updated.riskLevel),
      decidedAt,
    );
    return updated;
  }

  private recordAuditEvent(
    actorId: string | undefined,
    action: string,
    planId: string,
    changes: unknown,
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
    createdAt: number,
  ): void {
    this.db.prepare(`
      INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, risk_level, changes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId('audit'),
      actorId ?? null,
      action,
      'feishu_confirmation',
      planId,
      riskLevel,
      changes ? safeJsonStringify(changes) : null,
      createdAt,
    );
  }
}
