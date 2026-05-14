/**
 * Command handlers for CSV preview and edit.
 */

import * as vscode from 'vscode';
import { extname, basename, dirname, join } from 'path';
import { CsvPreviewPanel } from '../panels/CsvPreviewPanel';
import { DuckDbService } from '../services/DuckDbService';
import { ConfigService } from '../services/ConfigService';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv']);

export type EditMode = 'readonly' | 'edit';

/**
 * Register all preview/edit commands.
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  duckDb: DuckDbService,
  configService: ConfigService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'csv-enhanced.preview',
      (uri?: vscode.Uri) => openPreview(context, duckDb, configService, uri, vscode.ViewColumn.Active, 'readonly')
    ),
    vscode.commands.registerCommand(
      'csv-enhanced.previewToSide',
      (uri?: vscode.Uri) => openPreview(context, duckDb, configService, uri, vscode.ViewColumn.Beside, 'readonly')
    ),
    vscode.commands.registerCommand(
      'csv-enhanced.edit',
      (uri?: vscode.Uri) => openPreview(context, duckDb, configService, uri, vscode.ViewColumn.Active, 'edit')
    )
  );
}

async function openPreview(
  context: vscode.ExtensionContext,
  duckDb: DuckDbService,
  configService: ConfigService,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  mode: EditMode
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

  // In readonly mode, compute the _edit output path (modifications go there)
  let savePath: string;
  if (mode === 'edit') {
    savePath = resolvedUri.fsPath;
  } else {
    const dir = dirname(resolvedUri.fsPath);
    const name = basename(resolvedUri.fsPath, ext);
    savePath = join(dir, `${name}_edit${ext}`);
  }

  CsvPreviewPanel.createOrShow(context.extensionUri, duckDb, configService, resolvedUri, viewColumn, mode, savePath);
}
