/**
 * Service responsible for loading, parsing, and validating CSV files.
 * Decoupled from any UI concern.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { ConfigService } from './ConfigService';
import { CsvPayload, MoreRowsPayload } from '../types';
import { detectDelimiter, getDelimiterName } from '../utils/delimiter';
import { parseCSV, getSample, validateCSV, estimateRowCount } from '../utils/csvParser';

export class CsvParserService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Load and parse a CSV file, returning the payload ready for the webview.
   * Throws on validation or size errors.
   */
  async loadFile(uri: vscode.Uri): Promise<CsvPayload> {
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.size > this.config.maxFileSize) {
      const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
      throw new Error(`File is too large (${sizeMB} MB). Maximum size is 100 MB.`);
    }

    const textContent = await this.readFileAsText(uri);

    if (!textContent.trim()) {
      throw new Error('File is empty');
    }

    const sample = getSample(textContent, 10);
    const delimiter = detectDelimiter(sample, this.config.delimiter);
    const maxRows = this.config.maxRows;
    const parseResult = parseCSV(textContent, { delimiter, maxRows });

    const validation = validateCSV(parseResult);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Invalid CSV format');
    }

    const estimatedTotal = estimateRowCount(textContent);

    return {
      headers: parseResult.headers,
      rows: parseResult.data,
      totalRows: parseResult.totalRows,
      estimatedTotal,
      delimiter: getDelimiterName(delimiter),
      fileName: basename(uri.fsPath),
      fileSize: stat.size,
      hasMore: parseResult.totalRows >= maxRows,
    };
  }

  /**
   * Load additional rows beyond what was initially parsed.
   */
  async loadMoreRows(uri: vscode.Uri, currentRows: number): Promise<MoreRowsPayload> {
    const textContent = await this.readFileAsText(uri);
    const sample = getSample(textContent, 10);
    const delimiter = detectDelimiter(sample, this.config.delimiter);
    const newMax = currentRows + this.config.batchSize;

    const parseResult = parseCSV(textContent, { delimiter, maxRows: newMax });
    const newRows = parseResult.data.slice(currentRows);

    return {
      rows: newRows,
      hasMore: parseResult.totalRows >= newMax,
    };
  }

  private async readFileAsText(uri: vscode.Uri): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf8');
  }
}
