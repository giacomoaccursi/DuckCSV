/**
 * HtmlShellBuilder — chainable builder for webview HTML shells.
 *
 * Replaces the growing HtmlShellOptions interface with a fluent API.
 * Usage:
 *   new HtmlShellBuilder(webview, extensionUri)
 *     .title('CSV Preview')
 *     .script('script.js')
 *     .toolbar(toolbarHtml)
 *     .queryBar()
 *     .loading()
 *     .build();
 */

import * as vscode from 'vscode';
import { buildHtmlShell } from './htmlBuilder';

export class HtmlShellBuilder {
  private _title = 'DuckCSV';
  private _scriptPath = 'script.js';
  private _toolbarHtml = '';
  private _extraSectionsHtml = '';
  private _showQueryBar = false;
  private _showLoading = false;
  private _readonly = false;

  constructor(
    private readonly webview: vscode.Webview,
    private readonly extensionUri: vscode.Uri
  ) {}

  title(title: string): this {
    this._title = title;
    return this;
  }

  script(scriptPath: string): this {
    this._scriptPath = scriptPath;
    return this;
  }

  toolbar(html: string): this {
    this._toolbarHtml = html;
    return this;
  }

  extraSections(html: string): this {
    this._extraSectionsHtml = html;
    return this;
  }

  queryBar(): this {
    this._showQueryBar = true;
    return this;
  }

  loading(): this {
    this._showLoading = true;
    return this;
  }

  readonly(): this {
    this._readonly = true;
    return this;
  }

  build(): string {
    return buildHtmlShell({
      webview: this.webview,
      extensionUri: this.extensionUri,
      title: this._title,
      scriptPath: this._scriptPath,
      toolbarHtml: this._toolbarHtml,
      extraSectionsHtml: this._extraSectionsHtml,
      showQueryBar: this._showQueryBar,
      showLoading: this._showLoading,
      readonly: this._readonly,
    });
  }
}
