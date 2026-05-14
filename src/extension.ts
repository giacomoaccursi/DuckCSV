/**
 * CSV Enhanced Extension — Entry Point
 *
 * Bootstraps services and registers commands.
 */

import * as vscode from 'vscode';
import { ConfigService } from './services/ConfigService';
import { CsvParserService } from './services/CsvParserService';
import { registerPreviewCommands } from './commands/previewCommand';

export function activate(context: vscode.ExtensionContext): void {
  const configService = new ConfigService();
  const parserService = new CsvParserService(configService);

  context.subscriptions.push(configService);

  registerPreviewCommands(context, parserService, configService);
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code
}
