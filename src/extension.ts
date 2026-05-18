/**
 * DuckCSV Extension — Entry Point
 *
 * Bootstraps services and registers commands.
 * DuckDB is initialized lazily on first CSV open.
 */

import * as vscode from 'vscode';
import { DuckDbEngine } from './services/DuckDbEngine';
import { TableManager } from './services/TableManager';
import { QueryExecutor } from './services/QueryExecutor';
import { TableExporter } from './services/TableExporter';
import { QueryHistoryService } from './services/QueryHistoryService';
import { Services } from './services/Services';
import { registerPreviewCommands } from './commands/previewCommand';

export function activate(context: vscode.ExtensionContext): void {
  const engine = new DuckDbEngine();
  const tableManager = new TableManager(engine);
  const queryExecutor = new QueryExecutor(engine);
  const tableExporter = new TableExporter(engine, tableManager);
  const queryHistory = new QueryHistoryService(context.globalState);

  const services: Services = { engine, tableManager, queryExecutor, tableExporter, queryHistory };

  context.subscriptions.push(engine);

  registerPreviewCommands(context, services);
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code
}
