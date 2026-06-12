import type { AnalyticsDatabase } from './analytics-database';
import type {
  DailySummary,
  MetricQuery,
  PeriodComparison,
  ProductRankingItem,
  ProductRankingQuery,
  ReviewSummary,
} from './rpa-types';

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function storeFilter(storeIds: string[]): string {
  if (storeIds.length === 0) {
    throw new Error('至少需要提供一个门店 ID');
  }
  return storeIds.map(sqlString).join(', ');
}

function platformFilter(platform?: string): string {
  return platform ? `AND platform = ${sqlString(platform)}` : '';
}

function numberValue(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export class MetricService {
  constructor(private readonly analytics: AnalyticsDatabase) {}

  async getDailySummary(input: MetricQuery): Promise<DailySummary> {
    const stores = storeFilter(input.storeIds);
    const platform = platformFilter(input.platform);
    const storeDaily = await this.analytics.get<Record<string, unknown>>(`
      SELECT
        COALESCE(SUM(revenue), 0) AS revenue,
        COALESCE(SUM(order_count), 0) AS store_daily_order_count,
        COALESCE(AVG(NULLIF(store_score, 0)), 0) AS store_score,
        COALESCE(SUM(bad_review_count), 0) AS store_daily_bad_review_count
      FROM fact_store_daily
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
    `);
    const orders = await this.analytics.get<Record<string, unknown>>(`
      SELECT
        COUNT(*) AS order_count,
        COALESCE(SUM(paid_amount), 0) AS paid_amount
      FROM fact_orders
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
    `);
    const products = await this.analytics.get<Record<string, unknown>>(`
      SELECT COUNT(DISTINCT product_name) AS product_count
      FROM fact_products_daily
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
    `);
    const reviews = await this.analytics.get<Record<string, unknown>>(`
      SELECT COUNT(*) FILTER (WHERE rating > 0 AND rating <= 2) AS bad_review_count
      FROM fact_reviews
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
    `);

    const orderCount = numberValue(orders?.order_count) || numberValue(storeDaily?.store_daily_order_count);
    const revenue = numberValue(storeDaily?.revenue) || numberValue(orders?.paid_amount);

    return {
      storeIds: input.storeIds,
      startDate: input.startDate,
      endDate: input.endDate,
      platform: input.platform,
      revenue,
      orderCount,
      avgOrderValue: orderCount > 0 ? revenue / orderCount : 0,
      productCount: numberValue(products?.product_count),
      storeScore: numberValue(storeDaily?.store_score),
      badReviewCount: numberValue(reviews?.bad_review_count) || numberValue(storeDaily?.store_daily_bad_review_count),
    };
  }

  async getProductRanking(input: ProductRankingQuery): Promise<ProductRankingItem[]> {
    const stores = storeFilter(input.storeIds);
    const platform = platformFilter(input.platform);
    const limit = Math.max(1, Math.min(input.limit || 10, 50));
    const rows = await this.analytics.all<Record<string, unknown>>(`
      SELECT
        product_name AS productName,
        COALESCE(SUM(sales_count), 0) AS salesCount,
        COALESCE(SUM(sales_amount), 0) AS salesAmount
      FROM fact_products_daily
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
      GROUP BY product_name
      ORDER BY salesAmount DESC, salesCount DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      productName: String(row.productName || ''),
      salesCount: numberValue(row.salesCount),
      salesAmount: numberValue(row.salesAmount),
    }));
  }

  async getReviewSummary(input: MetricQuery): Promise<ReviewSummary> {
    const stores = storeFilter(input.storeIds);
    const platform = platformFilter(input.platform);
    const summary = await this.analytics.get<Record<string, unknown>>(`
      SELECT
        COUNT(*) AS review_count,
        COUNT(*) FILTER (WHERE rating > 0 AND rating <= 2) AS bad_review_count,
        COALESCE(AVG(NULLIF(rating, 0)), 0) AS average_rating
      FROM fact_reviews
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
    `);
    const recentRows = await this.analytics.all<Record<string, unknown>>(`
      SELECT content
      FROM fact_reviews
      WHERE store_id IN (${stores})
        AND business_date BETWEEN ${sqlString(input.startDate)}::DATE AND ${sqlString(input.endDate)}::DATE
        ${platform}
        AND content IS NOT NULL
      ORDER BY loaded_at DESC
      LIMIT 5
    `);

    return {
      reviewCount: numberValue(summary?.review_count),
      badReviewCount: numberValue(summary?.bad_review_count),
      averageRating: numberValue(summary?.average_rating),
      recentContents: recentRows.map((row) => String(row.content || '')).filter(Boolean),
    };
  }

  async comparePeriods(input: { current: MetricQuery; previous: MetricQuery }): Promise<PeriodComparison> {
    const current = await this.getDailySummary(input.current);
    const previous = await this.getDailySummary(input.previous);
    return {
      current,
      previous,
      revenueDelta: current.revenue - previous.revenue,
      orderCountDelta: current.orderCount - previous.orderCount,
    };
  }
}
