/**
 * HTML template for the Query Result panel.
 * Minimal toolbar: only search and export. No query bar, no loading duck.
 */

import * as vscode from 'vscode';
import { buildHtmlShell } from './htmlBuilder';

export function buildQueryResultHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="queryExportBtn" class="btn" data-tooltip="Export result to CSV file">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M3 13h10v1H3v-1zm5-1L4 8h2.5V3h3v5H12L8 12z"/>
          </svg>
        </button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>`;

  return buildHtmlShell({
    webview,
    extensionUri,
    title: 'Query Result',
    scriptPath: 'script.js',
    toolbarHtml,
    showQueryBar: false,
    showLoading: false,
  });
}
