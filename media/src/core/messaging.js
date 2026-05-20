/**
 * Communication layer between webview and extension host.
 */

// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

export function sendMessage(message) {
  vscode.postMessage(message);
}
