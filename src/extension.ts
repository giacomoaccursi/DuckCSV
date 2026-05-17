/**
 * DuckCSV Extension — Entry Point
 *
 * Bootstraps services and registers commands.
 * DuckDB is initialized lazily on first CSV open.
 */

import * as vscode from 'vscode';
import { ConfigService } from './services/ConfigService';
import { DuckDbEngine } from './services/DuckDbEngine';
import { TableManager } from './services/TableManager';
import { QueryExecutor } from './services/QueryExecutor';
import { TableExporter } from './services/TableExporter';
import { QueryHistoryService } from './services/QueryHistoryService';
import { registerPreviewCommands } from './commands/previewCommand';

export function activate(context: vscode.ExtensionContext): void {
  const configService = new ConfigService();
  const engine = new DuckDbEngine();
  const tableManager = new TableManager(engine);
  const queryExecutor = new QueryExecutor(engine);
  const tableExporter = new TableExporter(engine, tableManager);
  const queryHistory = new QueryHistoryService(context.globalState);

  context.subscriptions.push(configService, engine);

  registerPreviewCommands(context, engine, tableManager, queryExecutor, tableExporter, configService, queryHistory);
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code
}
