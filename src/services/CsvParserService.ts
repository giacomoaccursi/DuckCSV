/**
 * Service responsible for loading and parsing CSV files into CsvDocuments.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { ConfigService } from './ConfigService';
import { CsvDocument } from '../models/CsvDocument';
import { detectDelimiter, getDelimiterName } from '../utils/delimiter';
import { parseCSV, getSample, validateCSV } from '../utils/csvParser';

export class CsvParserService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Parse an entire CSV file into a CsvDocument (in-memory representation).
   * Throws on validation or size errors.
   */
  async loadDocument(uri: vscode.Uri): Promise<CsvDocument> {
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
    const parseResult = parseCSV(textContent, { delimiter });

    const validation = validateCSV(parseResult);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Invalid CSV format');
    }

    return new CsvDocument({
      headers: parseResult.headers,
      data: parseResult.data,
      fileName: basename(uri.fsPath),
      fileSize: stat.size,
      delimiter: getDelimiterName(delimiter),
    });
  }

  private async readFileAsText(uri: vscode.Uri): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf8');
  }
}
