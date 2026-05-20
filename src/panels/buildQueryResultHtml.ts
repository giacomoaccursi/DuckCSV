/**
 * HTML template for the Query Result panel.
 * Minimal toolbar: only search and export. No query bar, no loading duck.
 */

import * as vscode from 'vscode';
import { HtmlShellBuilder } from './HtmlShellBuilder';

export function buildQueryResultHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="exportBtnStandalone" class="btn" data-tooltip="Export result to CSV file">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M3 13h10v1H3v-1zm5-1L4 8h2.5V3h3v5H12L8 12z"/>
          </svg>
        </button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>
    <div id="queryLabel" class="query-label"></div>`;

  return new HtmlShellBuilder(webview, extensionUri)
    .title('Query Result')
    .script('script.js')
    .toolbar(toolbarHtml)
    .readonly()
    .build();
}
