/**
 * Shared HTML shell builder for webview panels.
 * Generates the full HTML with CSP, stylesheet, toolbar slot, query bar,
 * error/loading/table containers, and script tag.
 */

import * as vscode from 'vscode';
import { getNonce } from '../utils/nonce';

export interface HtmlShellOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  title: string;
  scriptPath: string;
  toolbarHtml: string;
  extraSectionsHtml?: string;
}

export function buildHtmlShell(options: HtmlShellOptions): string {
  const { webview, extensionUri, title, scriptPath, toolbarHtml, extraSectionsHtml } = options;

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', scriptPath)
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
  <title>${title}</title>
</head>
<body>
  <div id="app">
    ${toolbarHtml}

${extraSectionsHtml || ''}
    <div class="query-bar">
      <input type="text" id="queryInput" class="query-input" placeholder="SQL: SELECT * WHERE Status = 'Active' ORDER BY Name LIMIT 100" />
      <button id="queryRunBtn" class="btn" data-tooltip="Run query inline (replaces current view)">
        <svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2l10 6-10 6V2z"/></svg>
      </button>
      <button id="querySideBtn" class="btn" data-tooltip="Run query in side panel">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h6V3H2zm7 0v10h5V3H9z"/>
          <path fill="currentColor" d="M10.5 6.5l3 1.5-3 1.5v-3z"/>
        </svg>
      </button>
      <button id="queryClearBtn" class="btn hidden" data-tooltip="Clear query and return to data">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 9.8L10.8 11.5 8 8.7l-2.8 2.8-.7-.7L7.3 8 4.5 5.2l.7-.7L8 7.3l2.8-2.8.7.7L8.7 8l2.8 2.8z"/>
        </svg>
      </button>
      <button id="queryExportBtn" class="btn hidden" data-tooltip="Export query result to CSV file">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M3 13h10v1H3v-1zm5-1L4 8h2.5V3h3v5H12L8 12z"/>
        </svg>
      </button>
    </div>
    <div id="queryError" class="query-error hidden"></div>

    <div id="errorContainer" class="error-container hidden">
      <div class="error-message"><span id="errorText"></span></div>
    </div>

    <div id="loadingContainer" class="loading-container hidden">
      <div class="duck-spinner">🦆</div>
      <div>Loading...</div>
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
