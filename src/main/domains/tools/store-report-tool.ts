import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolCreateOptions, ToolPlugin } from './registry/tool-interface';
import { AnalyticsDatabase } from '../analytics/analytics-database';
import { MetricService } from '../analytics/metric-service';
import { ReportService } from '../analytics/report-service';
import { getErrorMessage } from '../../../shared/utils/error-handler';

function analyticsPath(): string {
  const dir = join(homedir(), '.deepbot');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'store-ops.duckdb');
}

function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

export const storeReportToolPlugin: ToolPlugin = {
  metadata: {
    id: 'store-report',
    name: '门店日报',
    description: '生成基于 RPA 数据集市的门店日报，供 LLM 解释和飞书卡片展示。',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['store', 'report', 'rpa'],
  },

  create(_options: ToolCreateOptions): AgentTool[] {
    const tool: AgentTool = {
      name: 'store_report',
      label: '门店日报',
      description: 'LLM 在用户要求生成日报、查看昨日经营概览、整理门店日报时调用本工具。工具返回结构化日报，数字来自数据库。',
      parameters: Type.Object({
        action: Type.Union([Type.Literal('generate_daily_report')]),
        store_ids: Type.Array(Type.String(), { description: '系统内部门店 ID 列表' }),
        business_date: Type.String({ description: '日报日期 YYYY-MM-DD' }),
        platform: Type.Optional(Type.String({ description: '平台，如 meituan/eleme/unknown' })),
      }),
      execute: async (_toolCallId: string, args: any) => {
        const analytics = await AnalyticsDatabase.open(analyticsPath());
        try {
          await analytics.ensureSchema();
          const report = await new ReportService(new MetricService(analytics)).generateDailyReport({
            storeIds: args.store_ids,
            businessDate: args.business_date,
            platform: args.platform,
          });

          return {
            content: [{ type: 'text' as const, text: `✅ 已生成${args.business_date}门店日报` }],
            details: { success: true, report },
          };
        } catch (error) {
          return errResult('生成门店日报失败', error);
        } finally {
          await analytics.close();
        }
      },
    };

    return [tool];
  },
};
