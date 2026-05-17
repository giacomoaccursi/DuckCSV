/**
 * HTML template builder for the CSV Preview webview.
 * Thin wrapper around the shared HTML shell.
 */

import * as vscode from 'vscode';
import { buildHtmlShell } from './htmlBuilder';

export function buildPreviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="saveBtn" class="btn" data-tooltip="Save to original file">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13.3 1.3L14.7 2.7 14.7 14 2 14 2 2 12.3 2zM13 3H12V6H5V3H3V13H13zM8 3v2h3V3z"/>
          </svg>
        </button>
        <button id="saveAsBtn" class="btn" data-tooltip="Save to a different file">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13.3 1.3L14.7 2.7 14.7 14 2 14 2 2 12.3 2zM13 3H12V6H5V3H3V13H13zM8 3v2h3V3z"/>
            <circle fill="currentColor" cx="12" cy="12" r="3"/>
            <path fill="var(--bg-primary)" d="M11.2 11.8h1.6v-1.2h.4v1.2h1.6v.4h-1.6v1.2h-.4v-1.2h-1.6z"/>
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

  return buildHtmlShell({
    webview,
    extensionUri,
    title: 'CSV Preview',
    scriptPath: 'script.js',
    toolbarHtml,
  });
}
