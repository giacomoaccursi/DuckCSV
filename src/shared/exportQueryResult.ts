/**
 * Shared handler for exporting query results to a CSV file.
 * Used by CsvPreviewPanel, CsvWorkspacePanel, and QueryResultPanel.
 */

import * as vscode from 'vscode';
import { quoteCsvField } from './csvUtils';

export async function exportQueryResultToFile(headers: string[], rows: string[][]): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('query_result.csv'),
    filters: { 'CSV Files': ['csv'], 'All Files': ['*'] },
    title: 'Export Query Result',
  });
  if (!uri) { return; }

  const delimiter = ',';
  const lines: string[] = [];
  lines.push(headers.map(h => quoteCsvField(h, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(row.map(cell => quoteCsvField(cell, delimiter)).join(delimiter));
  }

  const content = Buffer.from(lines.join('\n') + '\n', 'utf8');
  await vscode.workspace.fs.writeFile(uri, content);
  vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath.split('/').pop()}`);
}
