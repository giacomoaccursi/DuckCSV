/**
 * HTML template for the Column Profile panel.
 * Renders a stats grid with column statistics.
 */

import * as vscode from 'vscode';
import { ColumnProfile } from '../types';

export function buildProfileHtml(webview: vscode.Webview, extensionUri: vscode.Uri, profile: ColumnProfile): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));

  const isNumeric = profile.chartType === 'histogram';
  const statsRows = buildStatsRows(profile, isNumeric);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Column Profile</title>
  <style>
    .profile-container {
      padding: 16px;
      overflow-y: auto;
      height: 100vh;
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .profile-header h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--fg-primary);
      margin: 0;
    }
    .profile-type-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background-color: var(--vscode-badge-background, rgba(128,128,128,0.2));
      color: var(--fg-secondary);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .stat-card {
      padding: 10px 12px;
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
    }
    .stat-label {
      font-size: 10px;
      color: var(--fg-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 14px;
      font-weight: 600;
      color: var(--fg-primary);
      font-family: var(--vscode-editor-font-family, monospace);
    }
  </style>
</head>
<body>
  <div class="profile-container">
    <div class="profile-header">
      <h2>${escapeHtml(profile.columnName)}</h2>
      <span class="profile-type-badge">${escapeHtml(profile.columnType)}</span>
    </div>

    <div class="stats-grid">
      ${statsRows}
    </div>
  </div>
</body>
</html>`;
}

function buildStatsRows(profile: ColumnProfile, isNumeric: boolean): string {
  const stats: { label: string; value: string }[] = [
    { label: 'Total Rows', value: formatInt(profile.totalRows) },
    { label: 'Non-Null', value: formatInt(profile.nonNullCount) },
    { label: 'Unique', value: formatInt(profile.uniqueCount) },
    { label: 'Null %', value: formatPercent(profile.nullPercent) },
  ];

  if (isNumeric) {
    if (profile.min !== undefined) { stats.push({ label: 'Min', value: formatStat(profile.min) }); }
    if (profile.max !== undefined) { stats.push({ label: 'Max', value: formatStat(profile.max) }); }
    if (profile.mean !== undefined) { stats.push({ label: 'Mean', value: formatStat(profile.mean) }); }
    if (profile.median !== undefined) { stats.push({ label: 'Median', value: formatStat(profile.median) }); }
    if (profile.stddev !== undefined) { stats.push({ label: 'Std Dev', value: formatStat(profile.stddev) }); }
  }

  return stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${escapeHtml(s.value)}</div>
    </div>`).join('');
}

function formatInt(n: number): string {
  return n.toLocaleString();
}

function formatStat(val: string): string {
  const n = Number(val);
  if (isNaN(n)) { return val; }
  if (Number.isInteger(n)) { return n.toLocaleString(); }
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPercent(n: number): string {
  if (n === 0) { return '0%'; }
  if (n >= 1) { return n.toFixed(2) + '%'; }
  return n.toPrecision(2) + '%';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
