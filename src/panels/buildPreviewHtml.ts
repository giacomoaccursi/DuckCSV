/**
 * HTML template builder for the CSV Preview webview.
 * Thin wrapper around the shared HTML shell.
 */

import * as vscode from 'vscode';
import { HtmlShellBuilder } from './HtmlShellBuilder';

export function buildPreviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="saveBtn" class="btn" data-tooltip="Save to original file (Cmd+S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>
        <button id="saveAsBtn" class="btn" data-tooltip="Save to a different file (Cmd+Shift+S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v4"/>
            <polyline points="7 3 7 8 15 8"/>
            <path d="M17 18l3 3 3-3"/>
            <line x1="20" y1="14" x2="20" y2="21"/>
          </svg>
        </button>
        <button id="colorBtn" class="btn" data-tooltip="Toggle column colors for better readability">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <rect fill="#e06c75" x="1" y="2" width="3" height="12" rx="0.5"/>
            <rect fill="#e5c07b" x="5" y="2" width="3" height="12" rx="0.5"/>
            <rect fill="#61afef" x="9" y="2" width="3" height="12" rx="0.5"/>
            <rect fill="#98c379" x="13" y="2" width="2" height="12" rx="0.5"/>
          </svg>
        </button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
        <button id="openWorkspaceBtn" class="btn btn-text" data-tooltip="Open this file in a multi-table workspace">Workspace</button>
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>`;

  return new HtmlShellBuilder(webview, extensionUri)
    .title('CSV Preview')
    .script('script.js')
    .toolbar(toolbarHtml)
    .queryBar()
    .loading()
    .build();
}
