# DuckCSV

A fast CSV/TSV viewer and editor for VS Code. Open files with millions of rows, edit cells, run SQL queries — all without leaving your editor.

## Features

- **Open and browse** — Click a CSV file and see it as a table instantly. Scroll through hundreds of thousands of rows without lag.
- **Sort and filter** — Click column arrows to sort. Use per-column filter dropdowns to narrow down data. Search across all columns.
- **Edit in place** — Double-click any cell to edit. Insert or delete rows with right-click. Save changes back to the file with Cmd+S.
- **SQL queries** — Write DuckDB SQL directly in the query bar. Run inline or in a side panel. Autocomplete for column names.
- **JOIN across files** — Load multiple CSVs into a workspace and run SQL JOINs between them, like a local database.
- **Copy like Excel** — Select cells, rows, or columns. Copy with headers and delimiter.

## Getting Started

1. Open any `.csv` or `.tsv` file
2. Click the table icon in the top-right corner of the editor
3. That's it — you're in

**Commands:**
- `DuckCSV: Open Preview` — open the current file as an interactive table
- `DuckCSV: Open Workspace` — load multiple files and query across them

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `csv.delimiter` | auto | Delimiter (auto-detected, or force comma/semicolon/tab/pipe) |
| `csv.columnWidth.max` | 400 | Max column width in pixels |
| `csv.columnWidth.min` | 50 | Min column width in pixels |
| `csv.showRowNumbers` | true | Show row numbers |
| `csv.alternatingRowColors` | true | Alternating row colors |

## Requirements

- VS Code 1.106.0+
- No external tools needed — everything is bundled

## License

Apache 2.0 — see [LICENSE](LICENSE)
