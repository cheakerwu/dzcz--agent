import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const { default: Database } = require('../dist-electron/shared/utils/sqlite-adapter.js');
const {
  createFeishuConfirmationStore,
} = require('../dist-electron/main/domains/connectors/feishu/confirmation-card.js');
const {
  FeishuConfirmationAuditStore,
} = require('../dist-electron/main/domains/connectors/feishu/confirmation-audit-store.js');

test('Feishu confirmation audit store persists plan lifecycle and audit events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feishu-confirmation-audit-'));

  try {
    const db = new Database(join(dir, 'audit.db'));
    const auditStore = new FeishuConfirmationAuditStore(db);
    auditStore.ensureSchema();
    const confirmationStore = createFeishuConfirmationStore({ auditStore });

    const created = confirmationStore.create({
      planId: 'confirm_audit_plan_1',
      title: '价格调整确认',
      summary: '将锅包肉套餐从 94 元调整为 89 元',
      riskLevel: 'high',
      requesterId: 'ou_requester',
      requesterName: '小王',
      conversationId: 'oc_group',
      messageId: 'om_card',
      details: { 门店: '趣东北', 平台: '美团' },
      executionBinding: {
        toolName: 'browser_act',
        signature: 'sig_browser_save',
        summary: 'browser_act click button:保存',
      },
      createdAt: 1000,
    });

    assert.equal(created.status, 'pending');
    let persisted = auditStore.get('confirm_audit_plan_1');
    assert.equal(persisted.status, 'pending');
    assert.equal(persisted.title, '价格调整确认');
    assert.equal(persisted.riskLevel, 'high');
    assert.deepEqual(persisted.executionBinding, {
      toolName: 'browser_act',
      signature: 'sig_browser_save',
      summary: 'browser_act click button:保存',
    });
    assert.deepEqual(persisted.details, { 门店: '趣东北', 平台: '美团' });

    const approved = confirmationStore.approve('confirm_audit_plan_1', {
      operatorId: 'ou_admin',
      operatorName: '店长',
      decidedAt: 2000,
    });

    assert.equal(approved.status, 'approved');
    persisted = auditStore.get('confirm_audit_plan_1');
    assert.equal(persisted.status, 'approved');
    assert.equal(persisted.approvedById, 'ou_admin');
    assert.equal(persisted.approvedAt, 2000);

    const executed = auditStore.recordExecutionResult('confirm_audit_plan_1', {
      status: 'completed',
      toolName: 'browser_act',
      exitCode: 0,
      artifacts: ['/tmp/browseract-proof.png'],
      stdoutPreview: '保存成功',
      stderrPreview: '',
      executedAt: 2500,
    });
    assert.equal(executed.executionStatus, 'completed');
    assert.equal(executed.executionToolName, 'browser_act');
    assert.equal(executed.executionExitCode, 0);
    assert.deepEqual(executed.executionArtifacts, ['/tmp/browseract-proof.png']);
    assert.equal(executed.executedAt, 2500);

    confirmationStore.create({
      planId: 'confirm_audit_plan_2',
      title: '活动删除确认',
      summary: '删除无效活动',
      riskLevel: 'critical',
      requesterId: 'ou_requester',
      requesterName: '小王',
      conversationId: 'oc_group',
      messageId: 'om_card_2',
      details: { 门店: '趣东北' },
      createdAt: 3000,
    });
    confirmationStore.reject('confirm_audit_plan_2', {
      operatorId: 'ou_admin',
      operatorName: '店长',
      decidedAt: 4000,
    });

    const rejected = auditStore.get('confirm_audit_plan_2');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectedByName, '店长');
    assert.equal(rejected.rejectedAt, 4000);

    const rows = auditStore.list({ limit: 10 });
    assert.deepEqual(rows.map((row) => row.planId), ['confirm_audit_plan_2', 'confirm_audit_plan_1']);

    const auditEvents = db.prepare(`
      SELECT action, entity_type, entity_id, actor_id, risk_level, changes_json
      FROM audit_events
      WHERE entity_type = 'feishu_confirmation'
      ORDER BY created_at ASC
    `).all();

    assert.deepEqual(auditEvents.map((event) => event.action), [
      'feishu_confirmation.created',
      'feishu_confirmation.approved',
      'feishu_confirmation.execution_completed',
      'feishu_confirmation.created',
      'feishu_confirmation.rejected',
    ]);
    assert.equal(auditEvents[1].entity_id, 'confirm_audit_plan_1');
    assert.equal(auditEvents[1].actor_id, 'ou_admin');
    assert.equal(auditEvents[1].risk_level, 'high');
    assert.match(auditEvents[1].changes_json, /sig_browser_save/);
    assert.match(auditEvents[2].changes_json, /browseract-proof/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
