import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { readFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import type { ParsedRpaFile, RpaDataKind } from './rpa-types';

function normalizeKey(key: string): string {
  return key.replace(/\s+/g, '').replace(/[：:]/g, '').toLowerCase();
}

function getRowValue(row: Record<string, unknown>, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const candidate of candidates.map(normalizeKey)) {
    const found = entries.find(([key]) => normalizeKey(key) === candidate);
    if (found) return found[1];
  }
  for (const candidate of candidates.map(normalizeKey)) {
    const found = entries.find(([key]) => normalizeKey(key).includes(candidate));
    if (found) return found[1];
  }
  return undefined;
}

export function toStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

export function toNumberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = toStringValue(value);
  if (!text) return 0;
  const normalized = text.replace(/,/g, '').replace(/%/g, '').replace(/^ID:/, '');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toDateValue(value: unknown): string | undefined {
  const text = toStringValue(value);
  if (!text) return undefined;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

function inferDataKind(fileName: string): RpaDataKind {
  if (fileName.startsWith('门店')) return 'store';
  if (fileName.startsWith('订单')) return 'order';
  if (fileName.startsWith('商品')) return 'product';
  if (fileName.startsWith('评价')) return 'review';
  if (fileName.includes('门店下载')) return 'store';
  if (fileName.includes('订单下载')) return 'order';
  if (fileName.includes('商品下载')) return 'product';
  if (fileName.includes('评价下载')) return 'review';
  return 'unknown';
}

function inferDates(fileName: string, rows: Record<string, unknown>[]): { start?: string; end?: string } {
  const range = fileName.match(/(\d{8})(?:至|_)(\d{8})/);
  if (range) {
    return { start: toDateValue(range[1]), end: toDateValue(range[2]) };
  }
  const rowDate = rows.map((row) => toDateValue(getRowValue(row, ['日期', '业务日期']))).find(Boolean);
  return { start: rowDate, end: rowDate };
}

function inferPlatform(fileName: string, rows: Record<string, unknown>[]): string {
  if (/_mt/i.test(fileName) || fileName.includes('美团')) return 'meituan';
  if (fileName.includes('饿了么') || fileName.toLowerCase().includes('eleme')) return 'eleme';
  const sample = rows.slice(0, 5).map((row) => Object.values(row).join(' ')).join(' ');
  if (sample.includes('美团')) return 'meituan';
  if (sample.includes('饿了么')) return 'eleme';
  return 'unknown';
}

function inferStoreNameFromFile(fileName: string): string | undefined {
  const match = fileName.match(/^(?:门店|订单|商品|评价)_([^_]+)_/);
  return match?.[1];
}

function parseCsv(filePath: string): Record<string, unknown>[] {
  const buffer = readFileSync(filePath);
  const decoded = iconv.decode(buffer, 'gb18030');
  const workbook = XLSX.read(decoded, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[];
}

function parseExcel(filePath: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes('data') ? 'data' : workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[];
}

export function parseRpaFile(filePath: string): ParsedRpaFile {
  const fileName = basename(filePath);
  const extension = extname(filePath).toLowerCase();
  const fileType = extension === '.xlsx' ? 'xlsx' : 'csv';
  const fileHash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  const rows = fileType === 'xlsx' ? parseExcel(filePath) : parseCsv(filePath);
  const firstRow = rows[0] || {};
  const dates = inferDates(fileName, rows);
  const externalStoreId = toStringValue(getRowValue(firstRow, ['门店id', '门店ID', '门店 id', '门店编号', '店铺ID', '店铺id']));
  const externalStoreName = toStringValue(getRowValue(firstRow, ['门店名称', '店铺名称'])) || inferStoreNameFromFile(fileName);

  return {
    filePath,
    fileName,
    fileHash,
    fileType,
    sourceApp: 'rpa_file',
    platform: inferPlatform(fileName, rows),
    dataKind: inferDataKind(fileName),
    businessDateStart: dates.start,
    businessDateEnd: dates.end,
    externalStoreId,
    externalStoreName,
    rows,
  };
}

export function rpaField(row: Record<string, unknown>, candidates: string[]): unknown {
  return getRowValue(row, candidates);
}
