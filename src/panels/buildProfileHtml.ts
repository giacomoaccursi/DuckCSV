/**
 * HTML template for the Column Profile panel.
 * Renders stats grid + Chart.js chart for column distribution.
 */

import * as vscode from 'vscode';
import { ColumnProfile } from '../types';
import { getNonce } from '../utils/nonce';

export function buildProfileHtml(webview: vscode.Webview, extensionUri: vscode.Uri, profile: ColumnProfile): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
  const chartUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
  const nonce = getNonce();

  const isNumeric = profile.chartType === 'histogram';

  const statsRows = buildStatsRows(profile, isNumeric);
  const distributionJson = JSON.stringify(profile.distribution);
  const chartType = profile.chartType === 'histogram' ? 'bar' : profile.chartType;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Column Profile</title>
  <style nonce="${nonce}">
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
      margin-bottom: 24px;
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
    .chart-section {
      margin-top: 16px;
    }
    .chart-section h3 {
      font-size: 13px;
      font-weight: 600;
      color: var(--fg-primary);
      margin-bottom: 12px;
    }
    .chart-wrapper {
      position: relative;
      width: 100%;
      max-height: 300px;
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

    <div class="chart-section">
      <h3>Distribution</h3>
      <div class="chart-wrapper">
        <canvas id="profileChart"></canvas>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${chartUri}"></script>
  <script nonce="${nonce}">
    (function() {
      const distribution = ${distributionJson};
      const chartType = '${chartType}';
      const labels = distribution.map(d => d.label);
      const data = distribution.map(d => d.count);

      const ctx = document.getElementById('profileChart').getContext('2d');

      const style = getComputedStyle(document.body);
      const accentColor = style.getPropertyValue('--accent-color').trim() || '#4fc3f7';
      const fgSecondary = style.getPropertyValue('--fg-secondary').trim() || '#999';
      const borderColor = style.getPropertyValue('--border-color').trim() || '#333';

      new Chart(ctx, {
        type: chartType,
        data: {
          labels: labels,
          datasets: [{
            label: 'Count',
            data: data,
            backgroundColor: accentColor + '80',
            borderColor: accentColor,
            borderWidth: 1,
            tension: 0.3,
            fill: chartType === 'line',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(30,30,30,0.95)',
              titleColor: '#fff',
              bodyColor: '#ccc',
              borderColor: borderColor,
              borderWidth: 1,
            }
          },
          scales: {
            x: {
              ticks: {
                color: fgSecondary,
                maxRotation: 45,
                font: { size: 10 },
              },
              grid: { color: borderColor + '40' },
            },
            y: {
              ticks: { color: fgSecondary, font: { size: 10 } },
              grid: { color: borderColor + '40' },
              beginAtZero: true,
            }
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}

function buildStatsRows(profile: ColumnProfile, isNumeric: boolean): string {
  const stats: { label: string; value: string }[] = [
    { label: 'Total Rows', value: formatInt(profile.totalRows) },
    { label: 'Non-Null', value: formatInt(profile.nonNullCount) },
    { label: 'Unique', value: formatInt(profile.uniqueCount) },
    { label: 'Null %', value: `${profile.nullPercent}%` },
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
  return formatCompact(n);
}

function formatStat(val: string): string {
  const n = Number(val);
  if (isNaN(n)) { return val; }
  return formatCompact(n);
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) { return sign + (abs / 1e9).toFixed(2) + 'B'; }
  if (abs >= 1e6) { return sign + (abs / 1e6).toFixed(2) + 'M'; }
  if (abs >= 1e4) { return sign + (abs / 1e3).toFixed(1) + 'K'; }
  if (Number.isInteger(n)) { return String(n); }
  return n.toFixed(2);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
