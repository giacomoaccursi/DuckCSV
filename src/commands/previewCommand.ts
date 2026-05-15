/**
 * Command handlers for CSV preview and edit.
 */

import * as vscode from 'vscode';
import { extname, basename, dirname, join } from 'path';
import { CsvPreviewPanel } from '../panels/CsvPreviewPanel';
import { CsvWorkspacePanel } from '../panels/CsvWorkspacePanel';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { TableExporter } from '../services/TableExporter';
import { ConfigService } from '../services/ConfigService';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv']);

export type EditMode = 'readonly' | 'edit';

/**
 * Register all commands.
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  engine: DuckDbEngine,
  tableManager: TableManager,
  queryExecutor: QueryExecutor,
  tableExporter: TableExporter,
  configService: ConfigService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'duckcsv.preview',
      (uri?: vscode.Uri) => openPreview(context, tableManager, queryExecutor, tableExporter, configService, uri, vscode.ViewColumn.Active, 'readonly')
    ),
    vscode.commands.registerCommand(
      'duckcsv.previewToSide',
      (uri?: vscode.Uri) => openPreview(context, tableManager, queryExecutor, tableExporter, configService, uri, vscode.ViewColumn.Beside, 'readonly')
    ),
    vscode.commands.registerCommand(
      'duckcsv.edit',
      (uri?: vscode.Uri) => openPreview(context, tableManager, queryExecutor, tableExporter, configService, uri, vscode.ViewColumn.Active, 'edit')
    ),
    vscode.commands.registerCommand(
      'duckcsv.workspace',
      (uri?: vscode.Uri) => openWorkspace(context, engine, queryExecutor, configService, uri)
    )
  );
}

async function openPreview(
  context: vscode.ExtensionContext,
  tableManager: TableManager,
  queryExecutor: QueryExecutor,
  tableExporter: TableExporter,
  configService: ConfigService,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  mode: EditMode
): Promise<void> {
  let resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!resolvedUri) {
    // No active editor — open file picker
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'CSV Files': ['csv', 'tsv'] },
      title: 'Select a CSV file to preview',
    });
    if (!picked || picked.length === 0) { return; }
    resolvedUri = picked[0];
  }

  const ext = extname(resolvedUri.fsPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    vscode.window.showWarningMessage(
      `File "${basename(resolvedUri.fsPath)}" is not a CSV or TSV file.`
    );
    return;
  }

  let savePath: string;
  if (mode === 'edit') {
    savePath = resolvedUri.fsPath;
  } else {
    const dir = dirname(resolvedUri.fsPath);
    const name = basename(resolvedUri.fsPath, ext);
    savePath = join(dir, `${name}_edit${ext}`);
  }

  CsvPreviewPanel.createOrShow(context.extensionUri, tableManager, queryExecutor, tableExporter, configService, resolvedUri, viewColumn, mode, savePath);
}

async function openWorkspace(
  context: vscode.ExtensionContext,
  engine: DuckDbEngine,
  queryExecutor: QueryExecutor,
  configService: ConfigService,
  uri?: vscode.Uri
): Promise<void> {
  // If called with a URI, validate it
  let initialUri: vscode.Uri | undefined;
  if (uri) {
    const ext = extname(uri.fsPath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      initialUri = uri;
    }
  } else {
    // Try active editor
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
      const ext = extname(activeUri.fsPath).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        initialUri = activeUri;
      }
    }
  }

  CsvWorkspacePanel.createOrShow(context.extensionUri, engine, queryExecutor, configService, initialUri);
}
