/**
 * Command handlers for CSV preview and workspace.
 */

import * as vscode from 'vscode';
import { extname, basename } from 'path';
import { CsvPreviewPanel } from '../panels/CsvPreviewPanel';
import { CsvWorkspacePanel } from '../panels/CsvWorkspacePanel';
import { Services } from '../services/Services';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv', '.parquet']);

/**
 * Register all commands.
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  services: Services
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'duckcsv.preview',
      (uri?: vscode.Uri) => openPreview(context, services, uri, vscode.ViewColumn.Active)
    ),
    vscode.commands.registerCommand(
      'duckcsv.workspace',
      (uri?: vscode.Uri) => openWorkspace(context, services, uri)
    )
  );
}

async function openPreview(
  context: vscode.ExtensionContext,
  services: Services,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn
): Promise<void> {
  let resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!resolvedUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Data Files': ['csv', 'tsv', 'parquet'] },
      title: 'Select a file to preview',
    });
    if (!picked || picked.length === 0) { return; }
    resolvedUri = picked[0];
  }

  const ext = extname(resolvedUri.fsPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    vscode.window.showWarningMessage(
      `File "${basename(resolvedUri.fsPath)}" is not a supported file (CSV, TSV, or Parquet).`
    );
    return;
  }

  CsvPreviewPanel.createOrShow(context.extensionUri, services, resolvedUri, viewColumn);
}

async function openWorkspace(
  context: vscode.ExtensionContext,
  services: Services,
  uri?: vscode.Uri
): Promise<void> {
  let initialUri: vscode.Uri | undefined;
  if (uri) {
    const ext = extname(uri.fsPath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      initialUri = uri;
    }
  } else {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
      const ext = extname(activeUri.fsPath).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        initialUri = activeUri;
      }
    }
  }

  CsvWorkspacePanel.createOrShow(context.extensionUri, services, initialUri);
}
