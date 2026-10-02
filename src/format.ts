import { stripVTControlCharacters } from 'node:util';

export type Column = [string, (row: any) => unknown];

export function safe(value: unknown): string {
  return stripVTControlCharacters(String(value ?? '—')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

export function table(rows: any[], columns: Column[]): string {
  if (!rows.length) return '(none)';
  const cells = [columns.map(([title]) => title), ...rows.map(row => columns.map(([, get]) => safe(get(row))))];
  const widths = columns.map((_, index) => Math.max(...cells.map(row => row[index].length)));
  return cells.map(row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()).join('\n');
}

export function selectColumns(names: readonly string[], columns: Column[], requested?: string[]): Column[] {
  return requested ? requested.map(name => columns[names.indexOf(name)]!) : columns;
}
