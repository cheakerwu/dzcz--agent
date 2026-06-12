import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildFeishuConfirmationCard,
  createConfirmationPlanId,
  createFeishuConfirmationStore,
  summarizeConfirmationDetails,
} = require('../dist-electron/main/domains/connectors/feishu/confirmation-card.js');
const {
  handleCardCallback,
  setGatewayForCardCallback,
} = require('../dist-electron/main/domains/tools/feishu-card-callback.js');
const {
  feishuConfirmationToolPlugin,
  setConfigStoreForFeishuConfirmationTool,
} = require('../dist-electron/main/domains/tools/feishu-confirmation-tool.js');

test('buildFeishuConfirmationCard renders risk details and confirm/cancel actions', () => {
  const card = buildFeishuConfirmationCard({
    planId: 'confirm_plan_1',
    title: '价格调整确认',
    summary: '将锅包肉套餐从 94 元调整为 89 元',
    riskLevel: 'high',
    requesterName: '小王',
    details: {
      门店: '趣东北',
      平台: '美团',
      菜品: '锅包肉套餐',
      原价: '94',
      新价: '89',
    },
  });

  assert.equal(card.config.wide_screen_mode, true);
  assert.equal(card.header.template, 'red');
  assert.match(card.header.title.content, /价格调整确认/);

  const body = JSON.stringify(card);
  assert.match(body, /confirm_plan_1/);
  assert.match(body, /高风险/);
  assert.match(body, /趣东北/);
  assert.match(body, /锅包肉套餐/);
  assert.match(body, /feishu_confirmation_approve/);
  assert.match(body, /feishu_confirmation_reject/);
});

test('confirmation store tracks pending, approved, and rejected plans', () => {
  const store = createFeishuConfirmationStore();
  const planId = createConfirmationPlanId('price-change');

  store.create({
    planId,
    title: '价格调整确认',
    summary: '调整锅包肉套餐价格',
    riskLevel: 'high',
    requesterId: 'ou_requester',
    requesterName: '小王',
    conversationId: 'oc_group',
    messageId: 'om_card',
    details: { 门店: '趣东北' },
    createdAt: 1000,
  });

  assert.equal(store.get(planId).status, 'pending');
  assert.equal(store.approve(planId, { operatorId: 'ou_admin', operatorName: '店长', decidedAt: 2000 }).status, 'approved');
  assert.equal(store.get(planId).approvedByName, '店长');

  const rejectedId = createConfirmationPlanId('delete-campaign');
  store.create({
    planId: rejectedId,
    title: '活动删除确认',
    summary: '删除活动',
    riskLevel: 'critical',
    requesterId: 'ou_requester',
    conversationId: 'oc_group',
    details: {},
    createdAt: 3000,
  });

  assert.equal(store.reject(rejectedId, { operatorId: 'ou_admin', operatorName: '店长', decidedAt: 4000 }).status, 'rejected');
  assert.equal(store.get(rejectedId).rejectedByName, '店长');
});

test('summarizeConfirmationDetails formats object details for cards and tool responses', () => {
  const summary = summarizeConfirmationDetails({
    门店: '趣东北',
    平台: '美团',
    是否发布: true,
    数量: 3,
  });

  assert.match(summary, /门店：趣东北/);
  assert.match(summary, /平台：美团/);
  assert.match(summary, /是否发布：是/);
  assert.match(summary, /数量：3/);
});

test('feishu confirmation tool sends a card and records pending confirmation', async () => {
  const calls = [];
  const store = createFeishuConfirmationStore();
  const tool = feishuConfirmationToolPlugin.create({
    workspaceDir: process.cwd(),
    sessionId: 'tab_confirm',
    dependencies: {
      confirmationStore: store,
      sendInteractiveCard: async (input) => {
        calls.push(input);
        return { messageId: 'om_confirmation_card' };
      },
    },
  });

  const result = await tool.execute('call_1', {
    receive_id: 'oc_group',
    title: '价格调整确认',
    summary: '将锅包肉套餐从 94 元调整为 89 元',
    risk_level: 'high',
    requester_id: 'ou_requester',
    requester_name: '小王',
    details: { 门店: '趣东北', 平台: '美团' },
  });

  assert.equal(result.details.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conversationId, 'oc_group');
  assert.match(JSON.stringify(calls[0].card), /价格调整确认/);

  const plan = store.get(result.details.planId);
  assert.equal(plan.status, 'pending');
  assert.equal(plan.messageId, 'om_confirmation_card');
  assert.equal(plan.riskLevel, 'high');
});

test('card callback approves and rejects confirmation plans through Gateway', async () => {
  const calls = [];
  setGatewayForCardCallback({
    handleFeishuConfirmationAction: async (action, planId, operator) => {
      calls.push({ action, planId, operator });
      return `已处理 ${planId}`;
    },
  });

  const approved = await handleCardCallback(
    { action: 'feishu_confirmation_approve', plan_id: 'confirm_plan_1' },
    {
      operatorId: 'ou_admin',
      operatorName: '店长',
      messageId: 'om_card',
      chatId: 'oc_group',
    },
  );

  const rejected = await handleCardCallback(
    { action: 'feishu_confirmation_reject', plan_id: 'confirm_plan_2' },
    {
      operatorId: 'ou_admin',
      operatorName: '店长',
      messageId: 'om_card',
      chatId: 'oc_group',
    },
  );

  assert.equal(approved.replyMessage, '已处理 confirm_plan_1');
  assert.equal(rejected.replyMessage, '已处理 confirm_plan_2');
  assert.deepEqual(calls.map((call) => call.action), ['feishu_confirmation_approve', 'feishu_confirmation_reject']);
  assert.equal(calls[0].operator.operatorName, '店长');
});
