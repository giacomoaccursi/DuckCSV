/**
 * HTML template for the CSV Workspace webview.
 * Thin wrapper around the shared HTML shell.
 * Adds tables bar, table dropdown, and empty state.
 */

import * as vscode from 'vscode';
import { buildHtmlShell } from './htmlBuilder';

export function buildWorkspaceHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolbarHtml = /* html */ `
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="addTableBtn" class="btn" data-tooltip="Add CSV table to workspace">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
          Add Table
        </button>
        <select id="tableDropdown" class="table-dropdown" data-tooltip="Select table to view">
          <option value="">No tables loaded</option>
        </select>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>`;

  const extraSectionsHtml = /* html */ `
    <div id="tablesBar" class="tables-bar">
      <span class="tables-bar-label">Tables:</span>
      <div id="tablesBarList" class="tables-bar-list"></div>
    </div>

    <div id="emptyState" class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">Add CSV files to start</div>
      <button id="emptyAddBtn" class="btn btn-primary">+ Add Table</button>
    </div>
`;

  return buildHtmlShell({
    webview,
    extensionUri,
    title: 'CSV Workspace',
    scriptPath: 'workspace.js',
    toolbarHtml,
    extraSectionsHtml,
  });
}
