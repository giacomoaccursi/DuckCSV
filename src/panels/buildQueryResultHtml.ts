/**
 * HTML template for the Query Result panel.
 * Uses the same script as the main preview (virtual scroll, DataWindow)
 * but with a minimal toolbar (no save, no edit, no query bar).
 */

import * as vscode from 'vscode';
import { buildHtmlShell } from './htmlBuilder';

export function buildQueryResultHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
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
  });
}
