import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildFeishuTaskProgressCard,
  summarizeFeishuTaskProgress,
} = require('../dist-electron/main/domains/connectors/feishu/progress-card.js');
const { FeishuConnector } = require('../dist-electron/main/domains/connectors/feishu/feishu-connector.js');
const { GatewayConnectorHandler } = require('../dist-electron/main/infrastructure/gateway/gateway-connector.js');
const {
  handleCardCallback,
  setGatewayForCardCallback,
} = require('../dist-electron/main/domains/tools/feishu-card-callback.js');
const {
  globalFeishuConfirmationStore,
} = require('../dist-electron/main/domains/connectors/feishu/confirmation-card.js');

test('buildFeishuTaskProgressCard renders a running task card with status and stop actions', () => {
  const card = buildFeishuTaskProgressCard({
    taskTitle: '检查趣东北美团页面菜品信息',
    status: 'running',
    statusText: '正在打开商家后台',
    elapsedMs: 45_000,
    completedStepCount: 2,
    runningStepNames: ['browser_snapshot'],
    recentStepNames: ['匹配门店', '选择登录态'],
    tabId: 'tab_feishu_1',
  });

  assert.equal(card.config.wide_screen_mode, true);
  assert.equal(card.header.template, 'blue');
  assert.match(card.header.title.content, /任务执行中/);

  const body = JSON.stringify(card);
  assert.match(body, /检查趣东北美团页面菜品信息/);
  assert.match(body, /正在打开商家后台/);
  assert.match(body, /45 秒/);
  assert.match(body, /已完成 2 个步骤/);
  assert.match(body, /browser_snapshot/);

  const actionValues = card.elements
    .filter((element) => element.tag === 'action')
    .flatMap((element) => element.actions)
    .map((action) => action.value.action);

  assert.deepEqual(actionValues, ['feishu_task_progress_status', 'feishu_task_progress_stop']);
});

test('buildFeishuTaskProgressCard renders terminal states without stop action', () => {
  const card = buildFeishuTaskProgressCard({
    taskTitle: '生成周报',
    status: 'completed',
    statusText: '结果已发送到当前会话',
    elapsedMs: 125_000,
    completedStepCount: 4,
    tabId: 'tab_feishu_2',
  });

  assert.equal(card.header.template, 'green');
  assert.match(card.header.title.content, /任务完成/);

  const body = JSON.stringify(card);
  assert.match(body, /2 分 5 秒/);
  assert.doesNotMatch(body, /feishu_task_progress_stop/);
});

test('summarizeFeishuTaskProgress extracts concise runtime step status', () => {
  const summary = summarizeFeishuTaskProgress({
    streamingContent: '我正在核对门店页面和数据库记录。',
    steps: [
      { status: 'success', toolLabel: '匹配门店' },
      { status: 'success', toolLabel: '选择登录态' },
      { status: 'running', toolName: 'browser_snapshot' },
      { status: 'error', toolLabel: '读取商品表' },
    ],
  });

  assert.equal(summary.completedStepCount, 3);
  assert.deepEqual(summary.runningStepNames, ['browser_snapshot']);
  assert.deepEqual(summary.recentStepNames, ['匹配门店', '选择登录态', '读取商品表']);
  assert.match(summary.statusText, /browser_snapshot/);
});

test('FeishuConnector sends and updates interactive progress cards', async () => {
  const calls = [];
  const connector = new FeishuConnector({});
  connector.client = {
    im: {
      message: {
        reply: async (payload) => {
          calls.push(['reply', payload]);
          return { code: 0, data: { message_id: 'om_progress_card' } };
        },
        create: async (payload) => {
          calls.push(['create', payload]);
          return { code: 0, data: { message_id: 'om_created_card' } };
        },
        patch: async (payload) => {
          calls.push(['patch', payload]);
          return { code: 0 };
        },
      },
    },
  };

  assert.equal(typeof connector.outbound.sendInteractiveCard, 'function');
  assert.equal(typeof connector.outbound.updateInteractiveCard, 'function');

  const card = buildFeishuTaskProgressCard({
    taskTitle: '检查门店',
    status: 'running',
    tabId: 'tab_feishu_1',
  });

  const sent = await connector.outbound.sendInteractiveCard({
    conversationId: 'oc_group_1',
    card,
    replyToMessageId: 'om_original',
  });
  await connector.outbound.updateInteractiveCard({
    messageId: sent.messageId,
    card: buildFeishuTaskProgressCard({
      taskTitle: '检查门店',
      status: 'completed',
      tabId: 'tab_feishu_1',
    }),
  });

  assert.equal(sent.messageId, 'om_progress_card');
  assert.equal(calls[0][0], 'reply');
  assert.equal(calls[0][1].data.msg_type, 'interactive');
  assert.equal(calls[0][1].path.message_id, 'om_original');
  assert.equal(calls[1][0], 'patch');
  assert.equal(calls[1][1].path.message_id, 'om_progress_card');
});

test('GatewayConnectorHandler creates and completes a Feishu progress card for queued messages', async () => {
  const tab = {
    id: 'tab_feishu_1',
    type: 'connector',
    connectorId: 'feishu',
    conversationId: 'oc_group_1',
    pendingMessages: [
      {
        messageId: 'om_original',
        senderId: 'ou_1',
        senderName: '小王',
        content: '检查趣东北美团页面菜品信息',
        displayContent: '检查趣东北美团页面菜品信息',
        replyToMessageId: 'om_original',
        timestamp: Date.now(),
      },
    ],
  };
  const sentCards = [];
  const updatedCards = [];
  const sentTexts = [];

  const handler = new GatewayConnectorHandler();

  handler.setDependencies({
    mainWindow: { isDestroyed: () => false, webContents: { send: () => {} } },
    connectorManager: {
      sendInteractiveCard: async (connectorId, conversationId, card, replyToMessageId) => {
        sentCards.push({ connectorId, conversationId, card, replyToMessageId });
        return { messageId: 'om_progress_card' };
      },
      updateInteractiveCard: async (connectorId, messageId, card) => {
        updatedCards.push({ connectorId, messageId, card });
      },
      sendOutgoingMessage: async (connectorId, conversationId, content, replyToMessageId) => {
        sentTexts.push({ connectorId, conversationId, content, replyToMessageId });
      },
    },
    tabManager: {
      getTab: (tabId) => (tabId === tab.id ? tab : undefined),
    },
    sessionManager: null,
    handleSendMessage: async () => {
      await handler.sendResponseToConnector(tab.id, '检查完成，发现 2 个价格异常。');
    },
    getOrCreateRuntime: () => ({
      isCurrentlyGenerating: () => true,
      getExecutionSteps: () => [
        { status: 'success', toolLabel: '匹配门店' },
        { status: 'running', toolName: 'browser_snapshot' },
      ],
      getCurrentStreamingContent: () => '正在核对页面信息',
    }),
    sendAIResponse: async () => {},
    sendError: () => {},
    resetSessionRuntime: async () => null,
    executeSystemCommand: async () => '',
  });

  await handler.processNextMessage(tab.id);

  assert.equal(sentCards.length, 1);
  assert.equal(sentCards[0].connectorId, 'feishu');
  assert.equal(sentCards[0].conversationId, 'oc_group_1');
  assert.equal(sentCards[0].replyToMessageId, 'om_original');
  assert.match(JSON.stringify(sentCards[0].card), /任务执行中/);

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].content, '检查完成，发现 2 个价格异常。');
  assert.equal(sentTexts[0].replyToMessageId, 'om_original');

  assert.equal(updatedCards.length, 1);
  assert.equal(updatedCards[0].messageId, 'om_progress_card');
  assert.match(JSON.stringify(updatedCards[0].card), /任务完成/);
  assert.equal(tab.pendingMessages.length, 0);
});

test('GatewayConnectorHandler keeps a Feishu progress card alive when /status is requested', async () => {
  const pendingPlanId = `confirm_status_pending_${Date.now()}`;
  const tab = {
    id: 'tab_feishu_status',
    type: 'connector',
    connectorId: 'feishu',
    conversationId: 'oc_status',
    pendingMessages: [],
    processingMessageId: 'om_running',
  };
  const sentTexts = [];
  const updatedCards = [];

  const handler = new GatewayConnectorHandler();
  handler.setDependencies({
    mainWindow: { isDestroyed: () => false, webContents: { send: () => {} } },
    connectorManager: {
      sendOutgoingMessage: async (connectorId, conversationId, content, replyToMessageId) => {
        sentTexts.push({ connectorId, conversationId, content, replyToMessageId });
      },
      updateInteractiveCard: async (connectorId, messageId, card) => {
        updatedCards.push({ connectorId, messageId, card });
      },
      getConnector: () => null,
    },
    tabManager: {
      findTabByConversationKey: () => tab,
      getTab: (tabId) => (tabId === tab.id ? tab : undefined),
    },
    sessionManager: null,
    handleSendMessage: async () => {},
    getOrCreateRuntime: () => ({
      isCurrentlyGenerating: () => true,
      getExecutionSteps: () => [{ status: 'running', toolName: 'browser_snapshot' }],
      getCurrentStreamingContent: () => '正在核对页面信息',
    }),
    sendAIResponse: async () => {},
    sendError: () => {},
    resetSessionRuntime: async () => null,
    executeSystemCommand: async () => '',
  });

  handler.progressCards.set(tab.id, {
    messageId: 'om_progress_card',
    startedAt: Date.now(),
    taskTitle: '检查门店',
  });

  globalFeishuConfirmationStore.create({
    planId: pendingPlanId,
    title: '保存门店资料',
    summary: '点击保存按钮',
    riskLevel: 'high',
    conversationId: 'oc_status',
    requesterName: '小王',
    details: { 门店: '趣东北', 平台: '美团' },
  });

  await handler.handleConnectorMessage({
    tabId: '',
    messageId: 'om_status',
    timestamp: Date.now(),
    replyToMessageId: 'om_status',
    source: {
      type: 'connector',
      connectorId: 'feishu',
      conversationId: 'oc_status',
      senderId: 'ou_1',
      senderName: '小王',
      chatType: 'p2p',
    },
    content: {
      type: 'text',
      text: '/status',
    },
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].content, /任务正在执行中/);
  assert.match(sentTexts[0].content, /待确认/);
  assert.match(sentTexts[0].content, /保存门店资料/);
  assert.match(sentTexts[0].content, new RegExp(pendingPlanId));
  assert.equal(updatedCards.length, 0);
  assert.equal(handler.progressCards.has(tab.id), true);
});

test('card callback routes Feishu progress actions to Gateway', async () => {
  const calls = [];
  setGatewayForCardCallback({
    handleFeishuProgressCardAction: async (action, tabId) => {
      calls.push({ action, tabId });
      return '任务正在执行中';
    },
  });

  const result = await handleCardCallback(
    {
      action: 'feishu_task_progress_status',
      tab_id: 'tab_feishu_1',
    },
    {
      operatorId: 'ou_1',
      operatorName: '小王',
      messageId: 'om_card',
      chatId: 'oc_group_1',
    },
  );

  assert.deepEqual(calls, [{ action: 'feishu_task_progress_status', tabId: 'tab_feishu_1' }]);
  assert.equal(result.replyMessage, '任务正在执行中');
});
