/**
 * Minimal vscode mock for unit tests that import modules using vscode APIs.
 */

import { statSync } from 'fs';

export class Uri {
  readonly fsPath: string;
  private constructor(fsPath: string) { this.fsPath = fsPath; }
  static file(path: string): Uri { return new Uri(path); }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join('/'));
  }
  toString(): string { return `file://${this.fsPath}`; }
}

export const workspace = {
  fs: {
    stat: async (uri: Uri) => {
      const stats = statSync(uri.fsPath);
      return { mtime: stats.mtimeMs, size: stats.size };
    },
  },
};

export const window = {
  createWebviewPanel: () => ({}),
  showOpenDialog: async () => undefined,
  showErrorMessage: () => {},
  showWarningMessage: () => {},
  showInformationMessage: () => {},
  activeTextEditor: undefined,
};

export const env = {
  clipboard: { writeText: async () => {} },
};

export const ViewColumn = { Active: 1, Beside: 2 };

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => {},
};
