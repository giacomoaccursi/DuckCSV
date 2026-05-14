/**
 * HTML template for the CSV Workspace webview.
 * Includes tables bar and table dropdown (not present in single-file preview).
 */

import * as vscode from 'vscode';
import { getNonce } from '../utils/nonce';

export function buildWorkspaceHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'workspace.js')
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
  <title>CSV Workspace</title>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="addTableBtn" class="btn" title="Add CSV table to workspace">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
          Add Table
        </button>
        <select id="tableDropdown" class="table-dropdown" title="Select table to view">
          <option value="">No tables loaded</option>
        </select>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>

    <div id="tablesBar" class="tables-bar">
      <span class="tables-bar-label">Tables:</span>
      <div id="tablesBarList" class="tables-bar-list"></div>
    </div>

    <div class="query-bar">
      <input type="text" id="queryInput" class="query-input" placeholder="SQL: SELECT * FROM users JOIN orders ON users.ID = orders.UserID" />
      <button id="queryRunBtn" class="btn" title="Run query inline">
        <svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2l10 6-10 6V2z"/></svg>
      </button>
      <button id="querySideBtn" class="btn" title="Run query in side panel">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h6V3H2zm7 0v10h5V3H9z"/>
          <path fill="currentColor" d="M10.5 6.5l3 1.5-3 1.5v-3z"/>
        </svg>
      </button>
      <button id="queryClearBtn" class="btn hidden" title="Clear query">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 9.8L10.8 11.5 8 8.7l-2.8 2.8-.7-.7L7.3 8 4.5 5.2l.7-.7L8 7.3l2.8-2.8.7.7L8.7 8l2.8 2.8z"/>
        </svg>
      </button>
      <span id="queryError" class="query-error hidden"></span>
    </div>

    <div id="errorContainer" class="error-container hidden">
      <div class="error-message"><span id="errorText"></span></div>
    </div>

    <div id="loadingContainer" class="loading-container hidden">
      <div class="spinner"></div>
      <div>Loading...</div>
    </div>

    <div id="emptyState" class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">Add CSV files to start</div>
      <button id="emptyAddBtn" class="btn btn-primary">+ Add Table</button>
    </div>

    <div id="tableContainer" class="table-container hidden">
      <div class="table-wrapper">
        <table id="csvTable">
          <thead id="tableHeader"></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
      <div id="loadMoreContainer" class="load-more-container hidden">
        <button id="loadMoreBtn" class="btn btn-primary">Load More Rows</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
