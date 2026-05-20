/**
 * SidePanelOpener — interface for opening query result side panels.
 *
 * Decouples BasePanel from QueryResultPanel, eliminating the circular dependency
 * where the parent class (BasePanel) knew about its sibling (QueryResultPanel).
 */

import * as vscode from 'vscode';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { QueryResultPanel } from './QueryResultPanel';

export interface ISidePanelOpener {
  open(extensionUri: vscode.Uri, engine: DuckDbEngine, sql: string, sourceFileName?: string): Promise<void>;
}

/**
 * Default implementation that opens a QueryResultPanel.
 */
export const defaultSidePanelOpener: ISidePanelOpener = {
  async open(extensionUri, engine, sql, sourceFileName) {
    await QueryResultPanel.open(extensionUri, engine, sql, sourceFileName);
  },
};
