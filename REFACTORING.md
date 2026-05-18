# Refactoring Plan

## Code Cleanup

### 1. Remove dead code

**Files**: `query.js`, `renderer.js`, `QueryExecutor.ts`

- `QueryExecutor.execute()` — no longer called by anyone
- `QueryExecutor.normalizeSql()` — only used internally by the dead `execute()`
- `query.js` → `onQueryResult()` — the `queryResult` message type is no longer sent
- `query.js` → `sortQueryResultsLocally()` — replaced by backend sort
- `renderer.js` → `renderQueryRows()` — no longer used (inline query uses virtual scroll now)

### 2. Remove `state.rows` / `state.rowids` vestige

**Files**: `state.js`, `data-page.js`, `editing.js`, `main.js`

These arrays hold only the first 2000 rows from the initial `dataPage`. The `DataWindow` is the real source of truth. `state.rows` is written to in `editing.js` but never read back meaningfully. Remove them and use `DataWindow` exclusively.

### 3. Use ConfigService or remove it

**Files**: `ConfigService.ts`, all panels

`ConfigService` exposes `delimiter`, `maxColumnWidth`, `minColumnWidth`, `showRowNumbers`, `pageSize` — none of which are read by any panel. Either wire them into the relevant code or remove the service.

### 4. Centralize magic numbers

**Files**: `data-page.js`, `TableManager.ts`, `TableExporter.ts`, `QueryHistoryService.ts`

Constants scattered across files: `blockSize: 2000`, `maxBlocks: 50`, `prefetchThreshold: 1000`, `batchSize: 50_000`, `MAX_HISTORY = 50`, `firstBlockSize = 2000`. Create a `constants.ts` file.

### 5. Clean up `main.js` monolith

**File**: `main.js` (230+ lines)

Extract `onRowMutation` into `data-page.js` or a dedicated module. Separate event binding into logical groups (toolbar, editing, context menu).

### 6. Simplify context menu logic

**File**: `main.js`

The context menu has 3 branches (readonly / queryActive / normal) with duplicated code. Replace with a single menu builder function that takes the current state and returns the appropriate items.

### 7. Reduce `bindQueryBar` parameter count

**File**: `shared-bindings.js`

`bindQueryBar` takes 10+ parameters in a destructured object. Replace with a single `QueryBarContext` interface or use a mediator.

---

## Architecture Improvements

### 8. Service Container (Dependency Injection)

**Problem**: Services are passed through 4 levels of function calls. Adding `QueryHistoryService` required modifying `extension.ts` → `previewCommand.ts` → `CsvPreviewPanel.createOrShow` → constructor. Every new service repeats this.

**Solution**: A `Services` object that groups all services:

```typescript
interface Services {
  engine: DuckDbEngine;
  tableManager: TableManager;
  queryExecutor: QueryExecutor;
  tableExporter: TableExporter;
  config: ConfigService;
  queryHistory: QueryHistoryService;
}
```

Panels receive `Services` instead of 6+ individual parameters.

### 9. Extract `InlineQueryManager` from BasePanel

**Problem**: `BasePanel` is 350+ lines and manages inline query lifecycle (temp table creation, `__orig_rid` injection, cleanup, `getEffectiveTable` routing). This violates SRP.

**Solution**: Extract into a dedicated class:

```typescript
class InlineQueryManager {
  async executeInline(sql: string, tableName: string): Promise<string>; // returns temp table name
  clear(): Promise<void>;
  getActiveTable(defaultTable: string): string;
  isActive(): boolean;
}
```

BasePanel delegates to it instead of managing the state directly.

### 10. Extract `SqlBuilder` from TableManager

**Problem**: `TableManager` mixes business logic (mutations, view management) with SQL construction (`buildWhereStr`, `buildOrderClause`, `q()`).

**Solution**: A `SqlBuilder` utility class:

```typescript
class SqlBuilder {
  static quote(name: string): string;
  static buildWhere(filters: ColumnFilters, searchTerm: string, headers: string[]): string;
  static buildOrderBy(sort: SortState, headers: string[]): string;
}
```

### 11. Interface for DuckDbEngine

**Problem**: `TableManager` depends on the concrete `DuckDbEngine` class. Cannot unit-test `TableManager` without a real DuckDB instance.

**Solution**: Extract interface:

```typescript
interface IQueryEngine {
  query(sql: string): Promise<QueryResponse>;
  cancel(): void;
}
```

`TableManager` depends on `IQueryEngine`. Tests can provide a mock.

---

## Design Patterns to Introduce

### 12. Command Pattern for mutations (enables Undo/Redo)

**Current state**: `handleEditCell`, `handleAddRow`, `handleDeleteRow` are imperative procedures. No way to undo.

**Solution**: Each mutation becomes a `Command`:

```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
  description: string;
}

class EditCellCommand implements Command { ... }
class InsertRowCommand implements Command { ... }
class DeleteRowCommand implements Command { ... }
```

A `CommandHistory` stack enables Cmd+Z / Cmd+Shift+Z. This is a large refactor but high user value.

### 13. State Machine for frontend UI states

**Current state**: Multiple boolean flags (`queryRunning`, `queryActive`, `isSorting`, `isEditing`, `systemLoading`) scattered across modules. Invalid combinations are not prevented.

**Solution**: Explicit state machine:

```
States: IDLE | LOADING | READY | EDITING | QUERY_RUNNING | QUERY_ACTIVE | SORTING
Transitions:
  READY → EDITING (on dblclick)
  READY → QUERY_RUNNING (on Enter in query bar)
  QUERY_RUNNING → QUERY_ACTIVE (on dataPage with isQueryResult)
  QUERY_ACTIVE → READY (on clear)
  READY → SORTING (on sort click)
  SORTING → READY (on dataPage arrives)
```

Each state defines what's enabled/disabled. No more scattered `if (document.body.dataset.readonly)` checks.

### 14. Event Bus for frontend module communication

**Current state**: Modules import each other directly (`editing.js` imports `renderer.js`, `data-page.js` imports `query.js`). Creates tight coupling and potential circular dependencies.

**Solution**: A lightweight event bus:

```javascript
// bus.js
const listeners = new Map();
export function emit(event, data) { ... }
export function on(event, handler) { ... }

// editing.js
bus.emit('cell:committed', { rowid, col, value });

// data-page.js
bus.on('cell:committed', (data) => dw.updateCell(...));
```

### 15. Repository Interface for DataWindow

**Current state**: `DataWindow` is a concrete implementation used directly by renderer, selection, editing. Cannot be swapped or mocked.

**Solution**: Define interface:

```typescript
interface IRowDataSource {
  getRow(index: number): string[] | null;
  getRowid(index: number): number;
  getTotalRows(): number;
  isLoaded(index: number): boolean;
}
```

### 16. Builder Pattern for HTML (complete)

**Current state**: `HtmlShellOptions` grows with every new feature (`showQueryBar`, `showLoading`, `readonly`).

**Solution**: Chainable builder:

```typescript
new HtmlShellBuilder(webview, extensionUri)
  .title('CSV Preview')
  .script('script.js')
  .toolbar(toolbarHtml)
  .queryBar()
  .loading()
  .build();
```

---

## Priority Matrix

| # | Item | Effort | Impact | Risk |
|---|------|--------|--------|------|
| 1 | Remove dead code | Low | Low | None |
| 2 | Remove state.rows vestige | Low | Low | Low |
| 8 | Service Container | Medium | Medium | Low |
| 9 | Extract InlineQueryManager | Medium | Medium | Low |
| 11 | Interface for DuckDbEngine | Low | Medium | None |
| 10 | Extract SqlBuilder | Low | Low | None |
| 12 | Command Pattern (undo/redo) | High | High | Medium |
| 13 | State Machine | Medium | Medium | Medium |
| 3-7 | Other cleanup | Low | Low | None |
| 14-16 | Event Bus, Repository, Builder | Medium | Low | Low |

**Recommended order**: 1 → 2 → 11 → 8 → 9 → 10 → 3-7 → 12 (if undo/redo is wanted)
