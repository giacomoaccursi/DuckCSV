/**
 * QueryHistoryService — persists query history per file using globalState.
 */

import * as vscode from 'vscode';

const MAX_HISTORY = 50;
const KEY_PREFIX = 'queryHistory:';

export class QueryHistoryService {
  constructor(private readonly state: vscode.Memento) {}

  getHistory(fileKey: string): string[] {
    return this.state.get<string[]>(KEY_PREFIX + fileKey, []);
  }

  addQuery(fileKey: string, sql: string): string[] {
    const history = this.getHistory(fileKey);
    // Remove duplicate if exists
    const idx = history.indexOf(sql);
    if (idx !== -1) { history.splice(idx, 1); }
    // Add to front
    history.unshift(sql);
    // Trim
    if (history.length > MAX_HISTORY) { history.length = MAX_HISTORY; }
    this.state.update(KEY_PREFIX + fileKey, history);
    return history;
  }

  removeQuery(fileKey: string, sql: string): string[] {
    const history = this.getHistory(fileKey);
    const idx = history.indexOf(sql);
    if (idx !== -1) { history.splice(idx, 1); }
    this.state.update(KEY_PREFIX + fileKey, history);
    return history;
  }

  clearHistory(fileKey: string): void {
    this.state.update(KEY_PREFIX + fileKey, []);
  }

  saveHistory(fileKey: string, history: string[]): void {
    const trimmed = history.slice(0, MAX_HISTORY);
    this.state.update(KEY_PREFIX + fileKey, trimmed);
  }
}
