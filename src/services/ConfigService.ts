/**
 * Centralized access to extension configuration.
 * Caches the configuration reference and listens for changes.
 */

import * as vscode from 'vscode';

export class ConfigService implements vscode.Disposable {
  private cachedConfig: vscode.WorkspaceConfiguration;
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.cachedConfig = vscode.workspace.getConfiguration('csv');

    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('csv')) {
        this.cachedConfig = vscode.workspace.getConfiguration('csv');
      }
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }

  get delimiter(): string {
    return this.cachedConfig.get<string>('delimiter', 'auto');
  }

  get maxRows(): number {
    return this.cachedConfig.get<number>('previewRowCount', 10000);
  }

  get maxColumnWidth(): number {
    return this.cachedConfig.get<number>('columnWidth.max', 400);
  }

  get minColumnWidth(): number {
    return this.cachedConfig.get<number>('columnWidth.min', 50);
  }

  get showRowNumbers(): boolean {
    return this.cachedConfig.get<boolean>('showRowNumbers', true);
  }

  get enableSearch(): boolean {
    return this.cachedConfig.get<boolean>('enableSearch', true);
  }

  get alternatingRowColors(): boolean {
    return this.cachedConfig.get<boolean>('alternatingRowColors', true);
  }

  /** Maximum file size in bytes (100 MB) */
  get maxFileSize(): number {
    return 100 * 1024 * 1024;
  }

  /** Number of rows to load per batch when user clicks "Load More" */
  get batchSize(): number {
    return 5000;
  }
}
