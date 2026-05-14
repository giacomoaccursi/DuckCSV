/**
 * Query Result Panel — displays SQL query results in a side panel.
 * Read-only, static HTML. No messaging or interactivity.
 */

import * as vscode from 'vscode';
import { QueryResultPayload } from '../types';
import { getNonce } from '../utils/nonce';

export function openQueryResultPanel(
  extensionUri: vscode.Uri,
  payload: QueryResultPayload
): void {
  const panel = vscode.window.createWebviewPanel(
    'csvQueryResult',
    'Query Result',
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    }
  );

  const webview = panel.webview;
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'styles.css')
  );
  const nonce = getNonce();

  const bodyContent = payload.error
    ? `<div class="error-container"><div class="error-message"><span>${escapeHtml(payload.error)}</span></div></div>`
    : buildTableHtml(payload);

  panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Query Result</title>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="stats">SQL: ${escapeHtml(payload.sql)}</span>
      </div>
      <div class="toolbar-right">
        <span class="stats">${payload.rowCount} rows \u2022 ${payload.executionTimeMs.toFixed(1)}ms</span>
      </div>
    </div>
    <div class="table-container">
      <div class="table-wrapper">${bodyContent}</div>
    </div>
  </div>
</body>
</html>`;
}

function buildTableHtml(payload: QueryResultPayload): string {
  const headerCells = payload.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const bodyRows = payload.rows.map((row, i) => {
    const cells = row.map(cell => `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('');
    return `<tr><td class="row-number">${i + 1}</td>${cells}</tr>`;
  }).join('');

  return `<table id="csvTable">
    <thead><tr><th class="row-number-header">#</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
