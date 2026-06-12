import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolCreateOptions, ToolPlugin } from './registry/tool-interface';
import { SystemConfigStore } from '../../infrastructure/database/system-config-store';
import { AdminControlPlaneService } from '../admin-control-plane/service';
import { AnalyticsDatabase } from '../analytics/analytics-database';
import { RpaImportService } from '../analytics/rpa-import-service';
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

export const rpaDataImportToolPlugin: ToolPlugin = {
  metadata: {
    id: 'rpa-data-import',
    name: 'RPA 数据导入',
    description: '导入外部 RPA/影刀经营数据，支持文件目录接入，并保留数据库/API 接入边界。',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['rpa', 'store', 'data', 'import'],
  },

  create(_options: ToolCreateOptions): AgentTool[] {
    const tool: AgentTool = {
      name: 'rpa_data_import',
      label: 'RPA 数据导入',
      description: '让 LLM 在需要接入 RPA/影刀数据时调用。支持扫描目录、导入 CSV/Excel、确认外部门店映射；数据库/API 模式先返回明确的未配置提示。',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('scan_directory'),
          Type.Literal('import_files'),
          Type.Literal('list_unmatched_stores'),
          Type.Literal('confirm_store_mapping'),
          Type.Literal('sync_relay_database'),
          Type.Literal('receive_api_batch'),
        ]),
        source_dir: Type.Optional(Type.String({ description: 'RPA 下载文件目录' })),
        store_id: Type.Optional(Type.String({ description: '系统内部门店 ID' })),
        platform: Type.Optional(Type.String({ description: '平台，如 meituan/eleme/unknown' })),
        source_app: Type.Optional(Type.String({ description: '来源应用，默认 rpa_file' })),
        external_store_id: Type.Optional(Type.String({ description: '外部门店 ID' })),
        external_store_name: Type.Optional(Type.String({ description: '外部门店名称' })),
      }),
      execute: async (_toolCallId: string, args: any) => {
        try {
          const action = args.action;
          if (action === 'sync_relay_database' || action === 'receive_api_batch') {
            return {
              content: [{
                type: 'text' as const,
                text: '数据库中转/API 回调接入层已预留，但尚未配置影刀连接信息和字段协议。',
              }],
              details: {
                success: false,
                action,
                reason: 'relay_or_api_not_configured',
              },
            };
          }

          if (action === 'scan_directory') {
            if (!args.source_dir) throw new Error('source_dir is required');
            const service = new RpaImportService({
              admin: new AdminControlPlaneService(SystemConfigStore.getInstance().getDb()),
              analytics: await AnalyticsDatabase.open(analyticsPath()),
            });
            const files = await service.scanDirectory(args.source_dir);
            return {
              content: [{
                type: 'text' as const,
                text: `✅ 扫描完成，共 ${files.length} 个 RPA 文件`,
              }],
              details: { success: true, files },
            };
          }

          if (action === 'import_files') {
            if (!args.source_dir) throw new Error('source_dir is required');
            const analytics = await AnalyticsDatabase.open(analyticsPath());
            const service = new RpaImportService({
              admin: new AdminControlPlaneService(SystemConfigStore.getInstance().getDb()),
              analytics,
            });
            const result = await service.importDirectory(args.source_dir);
            await analytics.close();
            return {
              content: [{
                type: 'text' as const,
                text: `✅ 导入完成：新增 ${result.importedFiles} 个文件，跳过 ${result.skippedFiles} 个重复文件，未匹配门店 ${result.unmatchedStores.length} 个`,
              }],
              details: result,
            };
          }

          if (action === 'list_unmatched_stores') {
            if (!args.source_dir) throw new Error('source_dir is required');
            const admin = new AdminControlPlaneService(SystemConfigStore.getInstance().getDb());
            const analytics = await AnalyticsDatabase.open(analyticsPath());
            const service = new RpaImportService({ admin, analytics });
            const files = await service.scanDirectory(args.source_dir);
            await analytics.close();
            const unmatchedStores = files
              .filter((file) => !file.externalStoreId || !admin.findStoreByExternalId({
                platform: file.platform,
                sourceApp: file.sourceApp,
                externalStoreId: file.externalStoreId,
              }))
              .map((file) => ({
                platform: file.platform,
                sourceApp: file.sourceApp,
                externalStoreId: file.externalStoreId,
                externalStoreName: file.externalStoreName,
                fileName: file.fileName,
              }));
            return {
              content: [{
                type: 'text' as const,
                text: `✅ 未匹配门店扫描完成，共 ${unmatchedStores.length} 个`,
              }],
              details: { success: true, unmatchedStores },
            };
          }

          if (action === 'confirm_store_mapping') {
            if (!args.store_id || !args.platform || !args.external_store_id) {
              throw new Error('store_id, platform, external_store_id are required');
            }
            const admin = new AdminControlPlaneService(SystemConfigStore.getInstance().getDb());
            const mapping = admin.upsertExternalStoreMapping({
              storeId: args.store_id,
              platform: args.platform,
              sourceApp: args.source_app || 'rpa_file',
              externalStoreId: args.external_store_id,
              externalStoreName: args.external_store_name,
            }, 'agent_tool');
            return {
              content: [{ type: 'text' as const, text: `✅ 已绑定外部门店 ID：${mapping.externalStoreId}` }],
              details: { success: true, mapping },
            };
          }

          throw new Error(`Unsupported action: ${action}`);
        } catch (error) {
          return errResult('RPA 数据导入失败', error);
        }
      },
    };

    return [tool];
  },
};
