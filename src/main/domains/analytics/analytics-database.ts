import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

type QueryValues = Record<string, DuckDBValue>;

export class AnalyticsDatabase {
  private constructor(private readonly connection: DuckDBConnection) {}

  static async open(path = ':memory:'): Promise<AnalyticsDatabase> {
    const instance = await DuckDBInstance.fromCache(path);
    const connection = await instance.connect();
    return new AnalyticsDatabase(connection);
  }

  async ensureSchema(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS raw_files (
        file_id VARCHAR PRIMARY KEY,
        batch_id VARCHAR NOT NULL,
        file_path VARCHAR NOT NULL,
        file_name VARCHAR NOT NULL,
        file_hash VARCHAR NOT NULL,
        file_type VARCHAR NOT NULL,
        source_app VARCHAR NOT NULL,
        platform VARCHAR NOT NULL,
        data_kind VARCHAR NOT NULL,
        business_date_start DATE,
        business_date_end DATE,
        row_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await this.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_files_hash ON raw_files(file_hash)`);
    await this.run(`
      CREATE TABLE IF NOT EXISTS fact_store_daily (
        store_id VARCHAR NOT NULL,
        platform VARCHAR NOT NULL,
        source_app VARCHAR NOT NULL,
        business_date DATE NOT NULL,
        revenue DOUBLE DEFAULT 0,
        order_count INTEGER DEFAULT 0,
        avg_order_value DOUBLE DEFAULT 0,
        store_score DOUBLE DEFAULT 0,
        bad_review_count INTEGER DEFAULT 0,
        source_file_id VARCHAR NOT NULL,
        loaded_at BIGINT NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS fact_orders (
        store_id VARCHAR NOT NULL,
        platform VARCHAR NOT NULL,
        source_app VARCHAR NOT NULL,
        order_id VARCHAR NOT NULL,
        business_date DATE NOT NULL,
        paid_amount DOUBLE DEFAULT 0,
        product_summary VARCHAR,
        source_file_id VARCHAR NOT NULL,
        loaded_at BIGINT NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS fact_products_daily (
        store_id VARCHAR NOT NULL,
        platform VARCHAR NOT NULL,
        source_app VARCHAR NOT NULL,
        business_date DATE NOT NULL,
        product_name VARCHAR NOT NULL,
        sales_count DOUBLE DEFAULT 0,
        sales_amount DOUBLE DEFAULT 0,
        source_file_id VARCHAR NOT NULL,
        loaded_at BIGINT NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS fact_reviews (
        store_id VARCHAR NOT NULL,
        platform VARCHAR NOT NULL,
        source_app VARCHAR NOT NULL,
        review_id VARCHAR NOT NULL,
        business_date DATE NOT NULL,
        rating DOUBLE DEFAULT 0,
        content VARCHAR,
        reply_content VARCHAR,
        source_file_id VARCHAR NOT NULL,
        loaded_at BIGINT NOT NULL
      )
    `);
  }

  async run(sql: string, values?: QueryValues): Promise<void> {
    await this.connection.run(sql, values || {});
  }

  async all<T extends Record<string, unknown>>(sql: string, values?: QueryValues): Promise<T[]> {
    const reader = await this.connection.runAndReadAll(sql, values || {});
    return reader.getRowObjectsJson() as T[];
  }

  async get<T extends Record<string, unknown>>(sql: string, values?: QueryValues): Promise<T | undefined> {
    const rows = await this.all<T>(sql, values);
    return rows[0];
  }

  async close(): Promise<void> {
    this.connection.closeSync();
  }
}
