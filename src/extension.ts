/**
 * CSV Enhanced Extension — Entry Point
 *
 * Bootstraps services and registers commands.
 * DuckDB is initialized lazily on first CSV open.
 */

import * as vscode from 'vscode';
import { ConfigService } from './services/ConfigService';
import { DuckDbService } from './services/DuckDbService';
import { registerPreviewCommands } from './commands/previewCommand';

export function activate(context: vscode.ExtensionContext): void {
  const configService = new ConfigService();
  const duckDbService = new DuckDbService();

  context.subscriptions.push(configService, duckDbService);

  registerPreviewCommands(context, duckDbService, configService);
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code
}
