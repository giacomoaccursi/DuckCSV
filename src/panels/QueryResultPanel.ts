/**
 * Query Result Panel — displays SQL query results in a side panel.
 * Interactive: supports sorting, selection, and copy.
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
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    }
  );

  const webview = panel.webview;
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'query-result.js')
  );
  const nonce = getNonce();

  const errorHtml = payload.error
    ? `<div class="error-container"><div class="error-message"><span>${escapeHtml(payload.error)}</span></div></div>`
    : '';

  // Inject data as a global variable for the script to pick up
  const dataJson = JSON.stringify({
    headers: payload.headers,
    rows: payload.rows,
    rowCount: payload.rowCount,
    totalCount: payload.totalCount,
    executionTimeMs: payload.executionTimeMs,
    sql: payload.sql,
  });

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
        <span id="stats" class="stats"></span>
      </div>
    </div>

    ${errorHtml}

    <div class="table-container">
      <div class="table-wrapper">
        <table id="csvTable">
          <thead id="tableHeader"></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">window.__QUERY_RESULT__ = ${dataJson};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
