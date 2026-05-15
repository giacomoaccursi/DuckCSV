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
        <button id="refreshBtn" class="btn" data-tooltip="Reload file from disk">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13 2v4H9l1.6-1.6A4.5 4.5 0 0 0 8 3.5a4.5 4.5 0 1 0 4.5 4.5h1A5.5 5.5 0 1 1 8 2.5c1.4 0 2.7.5 3.6 1.4L13 2z"/>
          </svg>
        </button>
        <button id="openAsTextBtn" class="btn" data-tooltip="Open file as plain text">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M3 1h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 0v3h3L10 1zM5 6h6v1H5V6zm0 2h6v1H5V8zm0 2h4v1H5v-1z"/>
          </svg>
        </button>
        <button id="colorBtn" class="btn" data-tooltip="Toggle column colors for better readability">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 1c1.2 0 2.3.4 3.2 1H8V3h-.5V2.02c.2-.01.3-.02.5-.02zM4.8 3h2.7v3H2.3A5.97 5.97 0 0 1 4.8 3zM2 8c0-.4 0-.7.1-1h5.4v2H2.1C2 8.7 2 8.4 2 8zm2.8 5A5.97 5.97 0 0 1 2.3 10h5.2v3H4.8zm3.7 0V10h5.2a5.97 5.97 0 0 1-2.5 3H8.5zm5.4-4H8.5V6h5.4c.1.3.1.6.1 1s0 .7-.1 1z"/>
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
