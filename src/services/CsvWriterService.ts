/**
 * Service responsible for writing CsvDocument changes back to disk.
 * Uses debouncing to batch rapid edits into a single write.
 */

import * as vscode from 'vscode';
import { CsvDocument } from '../models/CsvDocument';

const WRITE_DEBOUNCE_MS = 1000;

export class CsvWriterService implements vscode.Disposable {
  private writeTimers = new Map<string, NodeJS.Timeout>();
  private pendingWrites = new Map<string, { uri: vscode.Uri; document: CsvDocument }>();

  dispose(): void {
    // Flush all pending writes immediately
    for (const [key, timer] of this.writeTimers) {
      clearTimeout(timer);
      const pending = this.pendingWrites.get(key);
      if (pending) {
        this.writeNow(pending.uri, pending.document);
      }
    }
    this.writeTimers.clear();
    this.pendingWrites.clear();
  }

  /**
   * Schedule a debounced write for the given document.
   * If called multiple times within WRITE_DEBOUNCE_MS, only the last one fires.
   */
  scheduleWrite(uri: vscode.Uri, document: CsvDocument): void {
    const key = uri.toString();

    // Clear existing timer
    const existing = this.writeTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // Store reference
    this.pendingWrites.set(key, { uri, document });

    // Schedule new write
    const timer = setTimeout(() => {
      this.writeTimers.delete(key);
      this.pendingWrites.delete(key);
      this.writeNow(uri, document);
    }, WRITE_DEBOUNCE_MS);

    this.writeTimers.set(key, timer);
  }

  private async writeNow(uri: vscode.Uri, document: CsvDocument): Promise<void> {
    try {
      const content = document.serialize();
      const encoded = Buffer.from(content, 'utf8');
      await vscode.workspace.fs.writeFile(uri, encoded);
      document.markClean();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown write error';
      vscode.window.showErrorMessage(`Failed to save CSV: ${msg}`);
    }
  }
}
