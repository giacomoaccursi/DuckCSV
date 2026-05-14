/**
 * Command handlers for CSV preview.
 */

import * as vscode from 'vscode';
import { extname, basename } from 'path';
import { CsvPreviewPanel } from '../panels/CsvPreviewPanel';
import { DuckDbService } from '../services/DuckDbService';
import { ConfigService } from '../services/ConfigService';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv']);

/**
 * Register all preview-related commands.
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  duckDb: DuckDbService,
  configService: ConfigService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'csv-enhanced.preview',
      (uri?: vscode.Uri) => openPreview(context, duckDb, configService, uri, vscode.ViewColumn.Active)
    ),
    vscode.commands.registerCommand(
      'csv-enhanced.previewToSide',
      (uri?: vscode.Uri) => openPreview(context, duckDb, configService, uri, vscode.ViewColumn.Beside)
    )
  );
}

async function openPreview(
  context: vscode.ExtensionContext,
  duckDb: DuckDbService,
  configService: ConfigService,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn
): Promise<void> {
  const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!resolvedUri) {
    vscode.window.showErrorMessage('No CSV file to preview. Please open a CSV file first.');
    return;
  }

  const ext = extname(resolvedUri.fsPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    vscode.window.showWarningMessage(
      `File "${basename(resolvedUri.fsPath)}" is not a CSV or TSV file.`
    );
    return;
  }

  CsvPreviewPanel.createOrShow(context.extensionUri, duckDb, configService, resolvedUri, viewColumn);
}
