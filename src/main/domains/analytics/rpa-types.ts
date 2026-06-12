export type RpaDataKind = 'store' | 'order' | 'product' | 'review' | 'unknown';

export interface ParsedRpaFile {
  filePath: string;
  fileName: string;
  fileHash: string;
  fileType: 'csv' | 'xlsx';
  sourceApp: string;
  platform: string;
  dataKind: RpaDataKind;
  businessDateStart?: string;
  businessDateEnd?: string;
  externalStoreId?: string;
  externalStoreName?: string;
  rows: Record<string, unknown>[];
}

export interface RpaUnmatchedStore {
  platform: string;
  sourceApp: string;
  externalStoreId?: string;
  externalStoreName?: string;
  fileName: string;
}

export interface RpaImportResult {
  success: boolean;
  batchId: string;
  importedFiles: number;
  skippedFiles: number;
  unmatchedStores: RpaUnmatchedStore[];
}

export interface MetricQuery {
  storeIds: string[];
  startDate: string;
  endDate: string;
  platform?: string;
}

export interface ProductRankingQuery extends MetricQuery {
  limit?: number;
}

export interface DailySummary {
  storeIds: string[];
  startDate: string;
  endDate: string;
  platform?: string;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  productCount: number;
  storeScore: number;
  badReviewCount: number;
}

export interface ProductRankingItem {
  productName: string;
  salesCount: number;
  salesAmount: number;
}

export interface ReviewSummary {
  reviewCount: number;
  badReviewCount: number;
  averageRating: number;
  recentContents: string[];
}

export interface PeriodComparison {
  current: DailySummary;
  previous: DailySummary;
  revenueDelta: number;
  orderCountDelta: number;
}

export interface DailyReportInput {
  storeIds: string[];
  businessDate: string;
  platform?: string;
}

export interface DailyReportSection {
  key: string;
  title: string;
  data: unknown;
}

export interface DailyReport {
  title: string;
  businessDate: string;
  storeIds: string[];
  platform?: string;
  sections: DailyReportSection[];
}
