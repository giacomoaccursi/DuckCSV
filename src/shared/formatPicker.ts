/**
 * Format picker — shows a QuickPick to choose export format (CSV or Parquet).
 * Used by Save As and Export in all panels.
 */

import * as vscode from 'vscode';

export type ExportFormat = 'csv' | 'parquet';

interface FormatPickerOptions {
  defaultName: string;
  defaultExtension?: string;
}

const FORMAT_ITEMS: vscode.QuickPickItem[] = [
  { label: '$(file) CSV', description: 'Comma-separated values (.csv)', detail: 'csv' },
  { label: '$(database) Parquet', description: 'Columnar format, compressed (.parquet)', detail: 'parquet' },
];

/**
 * Show a format picker then a save dialog. Returns the chosen URI or undefined if cancelled.
 */
export async function pickFormatAndSave(options: FormatPickerOptions): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showQuickPick(FORMAT_ITEMS, {
    placeHolder: 'Choose export format',
    title: 'Export Format',
  });
  if (!picked) { return undefined; }

  const format = picked.detail as ExportFormat;
  const ext = format === 'parquet' ? 'parquet' : (options.defaultExtension || 'csv');
  const defaultName = options.defaultName.replace(/\.[^.]+$/, '') + '.' + ext;

  const filters: { [name: string]: string[] } = format === 'parquet'
    ? { 'Parquet Files': ['parquet'], 'All Files': ['*'] }
    : { 'CSV Files': ['csv', 'tsv'], 'All Files': ['*'] };

  return vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters,
    title: `Save as ${format.toUpperCase()}`,
  });
}
