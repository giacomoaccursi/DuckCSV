/**
 * Command handlers for CSV preview.
 */

import * as vscode from 'vscode';
import { extname, basename } from 'path';
import { CsvPreviewPanel } from '../panels/CsvPreviewPanel';
import { CsvParserService } from '../services/CsvParserService';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv']);

/**
 * Register all preview-related commands.
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  parserService: CsvParserService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'csv-enhanced.preview',
      (uri?: vscode.Uri) => openPreview(context, parserService, uri, vscode.ViewColumn.Active)
    ),
    vscode.commands.registerCommand(
      'csv-enhanced.previewToSide',
      (uri?: vscode.Uri) => openPreview(context, parserService, uri, vscode.ViewColumn.Beside)
    )
  );
}

/**
 * Resolve the target URI and open the CSV preview panel.
 */
async function openPreview(
  context: vscode.ExtensionContext,
  parserService: CsvParserService,
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

  CsvPreviewPanel.createOrShow(context.extensionUri, parserService, resolvedUri, viewColumn);
}
