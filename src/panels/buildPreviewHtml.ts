/**
 * HTML template builder for the CSV Preview webview.
 * Separated from panel logic for readability and maintainability.
 */

import * as vscode from 'vscode';
import { getNonce } from '../utils/nonce';

export function buildPreviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'script.js')
  );
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>CSV Preview</title>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="refreshBtn" class="btn" title="Reload file from disk">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13 2v4H9l1.6-1.6A4.5 4.5 0 0 0 8 3.5a4.5 4.5 0 1 0 4.5 4.5h1A5.5 5.5 0 1 1 8 2.5c1.4 0 2.7.5 3.6 1.4L13 2z"/>
          </svg>
        </button>
        <button id="openAsTextBtn" class="btn" title="Open file as plain text">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M3 1h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 0v3h3L10 1zM5 6h6v1H5V6zm0 2h6v1H5V8zm0 2h4v1H5v-1z"/>
          </svg>
        </button>
        <button id="colorBtn" class="btn" title="Toggle column colors for better readability">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 1c1.2 0 2.3.4 3.2 1H8V3h-.5V2.02c.2-.01.3-.02.5-.02zM4.8 3h2.7v3H2.3A5.97 5.97 0 0 1 4.8 3zM2 8c0-.4 0-.7.1-1h5.4v2H2.1C2 8.7 2 8.4 2 8zm2.8 5A5.97 5.97 0 0 1 2.3 10h5.2v3H4.8zm3.7 0V10h5.2a5.97 5.97 0 0 1-2.5 3H8.5zm5.4-4H8.5V6h5.4c.1.3.1.6.1 1s0 .7-.1 1z"/>
          </svg>
        </button>
        <button id="addRowBtn" class="btn" title="Add new row at the end">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
        </button>
        <button id="openWorkspaceBtn" class="btn btn-text" title="Open this file in a multi-table workspace">Workspace</button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>

    <div class="query-bar">
      <input type="text" id="queryInput" class="query-input" placeholder="SQL: SELECT * WHERE Status = 'Active' ORDER BY Name LIMIT 100" />
      <button id="queryRunBtn" class="btn" title="Run query inline (replaces current view)">
        <svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2l10 6-10 6V2z"/></svg>
      </button>
      <button id="querySideBtn" class="btn" title="Run query in side panel">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h6V3H2zm7 0v10h5V3H9z"/>
          <path fill="currentColor" d="M10.5 6.5l3 1.5-3 1.5v-3z"/>
        </svg>
      </button>
      <button id="queryClearBtn" class="btn hidden" title="Clear query and return to data">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 9.8L10.8 11.5 8 8.7l-2.8 2.8-.7-.7L7.3 8 4.5 5.2l.7-.7L8 7.3l2.8-2.8.7.7L8.7 8l2.8 2.8z"/>
        </svg>
      </button>
    </div>
    <div id="queryError" class="query-error hidden"></div>

    <div id="errorContainer" class="error-container hidden">
      <div class="error-message"><span id="errorText"></span></div>
    </div>

    <div id="loadingContainer" class="loading-container hidden">
      <div class="spinner"></div>
      <div>Loading CSV...</div>
    </div>

    <div id="tableContainer" class="table-container hidden">
      <div class="table-wrapper">
        <table id="csvTable">
          <thead id="tableHeader"></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
