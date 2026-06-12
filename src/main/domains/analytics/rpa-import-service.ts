import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminControlPlaneService } from '../admin-control-plane/service';
import type { AnalyticsDatabase } from './analytics-database';
import {
  parseRpaFile,
  rpaField,
  toDateValue,
  toNumberValue,
  toStringValue,
} from './rpa-file-parser';
import type { ParsedRpaFile, RpaImportResult, RpaUnmatchedStore } from './rpa-types';

function now(): number {
  return Date.now();
}

function fileIdFor(parsed: ParsedRpaFile): string {
  return `file_${parsed.fileHash.slice(0, 16)}`;
}

function rowDate(row: Record<string, unknown>, parsed: ParsedRpaFile): string {
  return toDateValue(rpaField(row, ['日期', '业务日期', '账单日期'])) || parsed.businessDateStart || '1970-01-01';
}

export class RpaImportService {
  constructor(private readonly deps: { admin: AdminControlPlaneService; analytics: AnalyticsDatabase }) {}

  async scanDirectory(sourceDir: string): Promise<ParsedRpaFile[]> {
    return readdirSync(sourceDir)
      .filter((name) => /\.(csv|xlsx)$/i.test(name))
      .sort()
      .map((name) => parseRpaFile(join(sourceDir, name)));
  }

  async importDirectory(sourceDir: string): Promise<RpaImportResult> {
    await this.deps.analytics.ensureSchema();
    const batchId = `batch_${Date.now().toString(36)}`;
    const parsedFiles = await this.scanDirectory(sourceDir);
    const unmatchedStores: RpaUnmatchedStore[] = [];
    let importedFiles = 0;
    let skippedFiles = 0;

    for (const parsed of parsedFiles) {
      const existing = await this.deps.analytics.get(`SELECT file_id FROM raw_files WHERE file_hash = $hash`, {
        hash: parsed.fileHash,
      });
      if (existing) {
        skippedFiles++;
        continue;
      }

      const mapping = parsed.externalStoreId
        ? this.deps.admin.findStoreByExternalId({
          platform: parsed.platform,
          sourceApp: parsed.sourceApp,
          externalStoreId: parsed.externalStoreId,
        })
        : undefined;

      if (!mapping) {
        unmatchedStores.push({
          platform: parsed.platform,
          sourceApp: parsed.sourceApp,
          externalStoreId: parsed.externalStoreId,
          externalStoreName: parsed.externalStoreName,
          fileName: parsed.fileName,
        });
      }

      await this.insertRawFile(batchId, parsed, mapping ? 'imported' : 'unmatched');
      if (mapping) {
        await this.insertFacts(parsed, mapping.storeId);
      }
      importedFiles++;
    }

    return {
      success: unmatchedStores.length === 0,
      batchId,
      importedFiles,
      skippedFiles,
      unmatchedStores,
    };
  }

  private async insertRawFile(batchId: string, parsed: ParsedRpaFile, status: string): Promise<void> {
    await this.deps.analytics.run(`
      INSERT INTO raw_files (
        file_id, batch_id, file_path, file_name, file_hash, file_type,
        source_app, platform, data_kind, business_date_start, business_date_end,
        row_count, status, created_at
      ) VALUES (
        $fileId, $batchId, $filePath, $fileName, $fileHash, $fileType,
        $sourceApp, $platform, $dataKind, $businessDateStart, $businessDateEnd,
        $rowCount, $status, $createdAt
      )
    `, {
      fileId: fileIdFor(parsed),
      batchId,
      filePath: parsed.filePath,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      fileType: parsed.fileType,
      sourceApp: parsed.sourceApp,
      platform: parsed.platform,
      dataKind: parsed.dataKind,
      businessDateStart: parsed.businessDateStart ?? null,
      businessDateEnd: parsed.businessDateEnd ?? null,
      rowCount: parsed.rows.length,
      status,
      createdAt: now(),
    });
  }

  private async insertFacts(parsed: ParsedRpaFile, storeId: string): Promise<void> {
    if (parsed.dataKind === 'store') {
      await this.insertStoreDailyFacts(parsed, storeId);
    } else if (parsed.dataKind === 'order') {
      await this.insertOrderFacts(parsed, storeId);
    } else if (parsed.dataKind === 'product') {
      await this.insertProductFacts(parsed, storeId);
    } else if (parsed.dataKind === 'review') {
      await this.insertReviewFacts(parsed, storeId);
    }
  }

  private async insertStoreDailyFacts(parsed: ParsedRpaFile, storeId: string): Promise<void> {
    for (const row of parsed.rows) {
      const orderCount = toNumberValue(rpaField(row, ['有效订单', '订单数']));
      const revenue = toNumberValue(rpaField(row, ['营业收入', '收入', '营业额', '顾客实付总额', '顾客实付']));
      const avgOrderValue = toNumberValue(rpaField(row, ['实付单均价', '单均实付', '客单价']));
      await this.deps.analytics.run(`
        INSERT INTO fact_store_daily (
          store_id, platform, source_app, business_date, revenue, order_count,
          avg_order_value, store_score, bad_review_count, source_file_id, loaded_at
        ) VALUES (
          $storeId, $platform, $sourceApp, $businessDate, $revenue, $orderCount,
          $avgOrderValue, $storeScore, $badReviewCount, $sourceFileId, $loadedAt
        )
      `, {
        storeId,
        platform: parsed.platform,
        sourceApp: parsed.sourceApp,
        businessDate: rowDate(row, parsed),
        revenue,
        orderCount,
        avgOrderValue,
        storeScore: toNumberValue(rpaField(row, ['店铺分', '综合体验分', '近30日日均商家评分'])),
        badReviewCount: toNumberValue(rpaField(row, ['差评数', '商品差评数'])),
        sourceFileId: fileIdFor(parsed),
        loadedAt: now(),
      });
    }
  }

  private async insertOrderFacts(parsed: ParsedRpaFile, storeId: string): Promise<void> {
    let fallbackIndex = 0;
    for (const row of parsed.rows) {
      fallbackIndex++;
      await this.deps.analytics.run(`
        INSERT INTO fact_orders (
          store_id, platform, source_app, order_id, business_date, paid_amount,
          product_summary, source_file_id, loaded_at
        ) VALUES (
          $storeId, $platform, $sourceApp, $orderId, $businessDate, $paidAmount,
          $productSummary, $sourceFileId, $loadedAt
        )
      `, {
        storeId,
        platform: parsed.platform,
        sourceApp: parsed.sourceApp,
        orderId: toStringValue(rpaField(row, ['订单编号', '订单单号', '订单ID'])) || `${fileIdFor(parsed)}_${fallbackIndex}`,
        businessDate: rowDate(row, parsed),
        paidAmount: toNumberValue(rpaField(row, ['订单实付', '顾客实付', '顾客实付总额'])),
        productSummary: toStringValue(rpaField(row, ['商品信息', '订单详情'])) || null,
        sourceFileId: fileIdFor(parsed),
        loadedAt: now(),
      });
    }
  }

  private async insertProductFacts(parsed: ParsedRpaFile, storeId: string): Promise<void> {
    for (const row of parsed.rows) {
      await this.deps.analytics.run(`
        INSERT INTO fact_products_daily (
          store_id, platform, source_app, business_date, product_name, sales_count,
          sales_amount, source_file_id, loaded_at
        ) VALUES (
          $storeId, $platform, $sourceApp, $businessDate, $productName, $salesCount,
          $salesAmount, $sourceFileId, $loadedAt
        )
      `, {
        storeId,
        platform: parsed.platform,
        sourceApp: parsed.sourceApp,
        businessDate: rowDate(row, parsed),
        productName: toStringValue(rpaField(row, ['商品名', '商品名称'])) || '未知商品',
        salesCount: toNumberValue(rpaField(row, ['商品销量', '销量'])),
        salesAmount: toNumberValue(rpaField(row, ['商品销售额', '销售额'])),
        sourceFileId: fileIdFor(parsed),
        loadedAt: now(),
      });
    }
  }

  private async insertReviewFacts(parsed: ParsedRpaFile, storeId: string): Promise<void> {
    let fallbackIndex = 0;
    for (const row of parsed.rows) {
      fallbackIndex++;
      const reviewTime = toStringValue(rpaField(row, ['评价时间'])) || rowDate(row, parsed);
      await this.deps.analytics.run(`
        INSERT INTO fact_reviews (
          store_id, platform, source_app, review_id, business_date, rating,
          content, reply_content, source_file_id, loaded_at
        ) VALUES (
          $storeId, $platform, $sourceApp, $reviewId, $businessDate, $rating,
          $content, $replyContent, $sourceFileId, $loadedAt
        )
      `, {
        storeId,
        platform: parsed.platform,
        sourceApp: parsed.sourceApp,
        reviewId: toStringValue(rpaField(row, ['评价ID', '订单ID'])) || `${fileIdFor(parsed)}_${fallbackIndex}_${reviewTime}`,
        businessDate: rowDate(row, parsed),
        rating: toNumberValue(rpaField(row, ['总体评分', '商品评分', '味道评分'])),
        content: toStringValue(rpaField(row, ['评价内容'])) || null,
        replyContent: toStringValue(rpaField(row, ['商家回复', '回复内容'])) || null,
        sourceFileId: fileIdFor(parsed),
        loadedAt: now(),
      });
    }
  }
}
