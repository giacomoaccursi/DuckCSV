# DuckCSV — Review Architetturale

## Panoramica

DuckCSV è un'estensione VS Code che trasforma file CSV/TSV in tabelle interattive con DuckDB WASM come motore SQL. L'architettura è divisa in due mondi: il **backend TypeScript** (extension host + worker thread) e il **frontend JavaScript** (webview vanilla JS con virtual scrolling).

---

## Struttura del Codice

### Backend (src/) — 3.052 righe

| File | Righe | Responsabilità |
|------|-------|---------------|
| `services/TableManager.ts` | 511 | Core data layer: CRUD tabelle, paginazione via view materializzate, mutazioni, type widening/tightening |
| `panels/BasePanel.ts` | 297 | Classe astratta: routing messaggi, handler comuni (sort/search/filter/query/export/clipboard) |
| `panels/CsvPreviewPanel.ts` | 294 | Viewer singolo file: editing, save/saveAs, dirty tracking |
| `panels/CsvWorkspacePanel.ts` | 228 | Multi-tabella: add/remove/switch tabelle, JOIN |
| `workers/duckdb-worker.ts` | 199 | Worker thread: DuckDB WASM, esecuzione query, export Parquet |
| `panels/QueryResultPanel.ts` | 178 | Side panel per risultati SQL |
| `services/DuckDbEngine.ts` | 171 | Proxy al worker: lifecycle, message passing, cancellazione |
| `services/CommandHistory.ts` | 149 | Pattern Command per undo/redo (non ancora integrato) |
| `services/InlineQueryManager.ts` | 112 | Lifecycle query inline: temp table con __orig_rid |
| `panels/htmlBuilder.ts` | 116 | Generatore HTML shell con CSP |
| `types/index.ts` | 117 | Tipi condivisi: messaggi, payload, sort/filter |
| `services/SqlBuilder.ts` | 42 | Costruzione WHERE/ORDER BY |
| `services/TableExporter.ts` | 71 | Export CSV (batch) e Parquet (nativo DuckDB) |

### Frontend (media/src/) — 3.195 righe

| File | Righe | Responsabilità |
|------|-------|---------------|
| `selection.js` | 399 | Selezione Excel-like: multi-select, copy, navigazione |
| `renderer.js` | 348 | Rendering tabella: header, body, virtual scroller, highlight |
| `query.js` | 232 | Query bar: stato esecuzione, autocomplete |
| `shared-bindings.js` | 209 | Wiring condiviso: search, query bar, header, selezione |
| `data-window.js` | 202 | Cache a blocchi LRU per lazy loading |
| `virtual-scroll.js` | 187 | Virtual scroller: DOM recycling, spacer |
| `main.js` | 181 | Entry point preview |
| `data-page.js` | 148 | Gestione dati in arrivo, lifecycle DataWindow |
| `workspace-main.js` | 136 | Entry point workspace |

---

## Flusso Dati

```
Azione utente → postMessage → BasePanel.handleMessage → Service → engine.query(SQL) → Worker
                                                                                         ↓
UI aggiornata ← renderer ← applyDataPage ← postMessage ← BasePanel ← Service ← Worker risponde
```

### Lazy Loading (scroll)

```
Scroll → virtual-scroll.onScroll → DataWindow.prefetch(start, end)
  → fetchBlock(offset, limit) → postMessage('fetchPage')
    → BasePanel.handleFetchPage → tableManager.getDataPage
      → postMessage('pageData') → DataWindow.receiveBlock → softRefresh
```

### Materialized View (paginazione)

TableManager usa una temp table `__view_xxx` con colonna `__pos` (ROW_NUMBER) per paginazione posizionale O(1). La view è cachata con un fingerprint `tableName|where|orderBy` e ricostruita solo quando cambia sort/filter/search.

---

## Grafo Dipendenze Backend

```
extension.ts
└── Services { engine, tableManager, queryExecutor, tableExporter, queryHistory }
    └── previewCommand.ts
        ├── CsvPreviewPanel (usa Services condiviso)
        └── CsvWorkspacePanel (crea il PROPRIO TableManager!)

BasePanel (abstract)
├── TableManager (iniettato)
├── QueryExecutor (iniettato)
├── InlineQueryManager (creato internamente)
└── ViewState (creato internamente)

TableManager → IQueryEngine (interfaccia)
DuckDbEngine implements IQueryEngine → Worker thread
```

---

## Punti di Forza

1. **Separazione backend/frontend pulita** — comunicazione solo via postMessage tipizzato
2. **Worker thread** — l'extension host non si blocca mai, cancellazione via terminate+respawn
3. **View materializzata con fingerprint** — paginazione istantanea, rebuild solo quando necessario
4. **Virtual scrolling + DataWindow** — gestisce milioni di righe con ~60 DOM nodes
5. **BasePanel abstract** — elimina duplicazione tra 3 tipi di panel
6. **IQueryEngine interface** — TableManager testabile con mock
7. **SqlBuilder estratto** — logica SQL isolata e riusabile
8. **Export Parquet nativo** — COPY TO nel VFS + copyFileToBuffer, zero dipendenze esterne

---

## Problemi Architetturali

### 1. TableManager non condiviso nel Workspace

`CsvWorkspacePanel.createOrShow` crea un **nuovo** `TableManager` con `new TableManager(services.engine)`. Questo significa che le tabelle caricate nel workspace sono invisibili al `tableManager` condiviso in `Services`. Stessa cosa per `QueryResultPanel`. Non è un bug funzionale (ogni panel ha il suo namespace), ma crea confusione architetturale: il `Services.tableManager` è usato solo dal preview.

### 2. Dipendenza circolare nel frontend

`renderer.js` importa `getDataWindow` da `data-page.js`, e `data-page.js` importa `renderHeader`, `renderRows`, `getScroller` da `renderer.js`. Funziona per l'hoisting ES module ma è fragile e rende difficile il refactoring.

### 3. Stato globale mutabile (state.js)

`state` è un singleton mutabile modificato da 10+ moduli senza notifiche di cambiamento. Proprietà come `tableName` e `tableNames` vengono aggiunte dinamicamente. L'`event-bus.js` e `ui-state-machine.js` sono stati creati per risolvere questo problema ma non sono ancora integrati.

### 4. Moduli pattern non integrati

- `CommandHistory.ts` (149 righe) — undo/redo completo ma mai usato
- `event-bus.js` (54 righe) — pub/sub mai importato
- `ui-state-machine.js` (67 righe) — state machine mai collegata
- `row-data-source.js` (32 righe) — interfaccia mai enforced
- `HtmlShellBuilder.ts` (80 righe) — builder mai usato (i panel usano `buildHtmlShell` direttamente)

Questi moduli sono infrastruttura pronta per l'integrazione futura, ma attualmente sono codice morto.

### 5. QueryExecutor quasi vuoto

`QueryExecutor` (15 righe) espone solo `getEngine()` e `cancel()`. Non aggiunge logica significativa. I panel potrebbero usare `DuckDbEngine` direttamente. L'unico valore è come punto di estensione futuro.

### 6. Costanti duplicate

`BLOCK_SIZE`, `MAX_BLOCKS`, `PREFETCH_THRESHOLD` sono definite sia in `src/shared/constants.ts` che in `media/src/constants.js` con valori identici. Nessun meccanismo garantisce la sincronizzazione.

### 7. Error handling inconsistente

- Backend: `try/catch` con `postError()` (estrae `.message`). Nessun tipo di errore strutturato.
- Alcuni handler swallano errori: `dropTable().catch(() => {})`, `reloadIfChanged().catch {}`
- Frontend: errori mostrati come stringa generica nella UI

---

## Metriche

| Metrica | Valore |
|---------|--------|
| Righe totali (src + media/src) | ~6.250 |
| File TypeScript | 28 |
| File JavaScript (frontend) | 25 |
| Test | 159 (11 file) |
| Dipendenze runtime | 1 (@duckdb/duckdb-wasm) |
| Bundle extension (dev) | ~5 MB (dominato da DuckDB WASM) |
| Bundle webview (preview) | 79 KB |
| Bundle webview (workspace) | 72 KB |

---

## Raccomandazioni Prioritarie

1. **Integrare CommandHistory** in CsvPreviewPanel per abilitare undo/redo (alto valore utente)
2. **Integrare ui-state-machine** per eliminare i flag booleani sparsi (queryRunning, isSorting, systemLoading)
3. **Risolvere la dipendenza circolare** renderer↔data-page estraendo `getDataWindow` in un modulo separato
4. **Rimuovere o integrare** event-bus, row-data-source, HtmlShellBuilder — non lasciare codice morto
5. **Two-phase loading** per file grandi (preview istantanea + materializzazione in background)
