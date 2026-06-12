import type { MetricService } from './metric-service';
import type { DailyReport, DailyReportInput } from './rpa-types';

export class ReportService {
  constructor(private readonly metrics: MetricService) {}

  async generateDailyReport(input: DailyReportInput): Promise<DailyReport> {
    const query = {
      storeIds: input.storeIds,
      startDate: input.businessDate,
      endDate: input.businessDate,
      platform: input.platform,
    };
    const summary = await this.metrics.getDailySummary(query);
    const products = await this.metrics.getProductRanking({ ...query, limit: 5 });
    const reviews = await this.metrics.getReviewSummary(query);

    return {
      title: `每日经营日报 ${input.businessDate}`,
      businessDate: input.businessDate,
      storeIds: input.storeIds,
      platform: input.platform,
      sections: [
        { key: 'overview', title: '经营总览', data: summary },
        { key: 'products', title: '商品表现', data: products },
        { key: 'reviews', title: '评价摘要', data: reviews },
      ],
    };
  }
}
