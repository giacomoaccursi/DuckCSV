/**
 * CSV Enhanced Extension — Entry Point
 *
 * Bootstraps services and registers commands.
 */

import * as vscode from 'vscode';
import { ConfigService } from './services/ConfigService';
import { CsvParserService } from './services/CsvParserService';
import { CsvWriterService } from './services/CsvWriterService';
import { registerPreviewCommands } from './commands/previewCommand';

export function activate(context: vscode.ExtensionContext): void {
  const configService = new ConfigService();
  const parserService = new CsvParserService(configService);
  const writerService = new CsvWriterService();

  context.subscriptions.push(configService, writerService);

  registerPreviewCommands(context, parserService, writerService, configService);
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code
}
