---
inclusion: manual
---

# Piano: Grafici e Data Profiling

## Obiettivo

Aggiungere un bottone 📊 su ogni header di colonna che apre un side panel con statistiche aggregate e un grafico della distribuzione. Aggiungere anche una barra di stats sulla selezione (come Excel).

## Architettura

### Componenti

1. **Backend: `ColumnProfileService`** — calcola statistiche per una colonna
2. **Backend: `ColumnProfilePanel`** — side panel webview per mostrare stats + grafico
3. **Frontend: bottone 📊 nell'header** — trigga il profiling
4. **Frontend: selection stats bar** — mostra sum/avg/count sulla selezione corrente
5. **Libreria chart: uPlot (30KB)** — per histogram e bar chart nel side panel

### Flusso

```
Click 📊 su header → postMessage('profileColumn', { columnIndex })
  → BasePanel.handleProfileColumn(columnIndex)
    → Calcola stats con SQL su getEffectiveTable()
    → Apre ColumnProfilePanel con i dati
    → Il panel mostra stats + grafico
```

## Step di implementazione

### Step 1: Backend — Query per stats colonna

Aggiungere in `TableManager` un metodo:

```typescript
async getColumnProfile(tableName: string, columnIndex: number): Promise<ColumnProfile> {
  // Per colonne numeriche:
  // SELECT COUNT(*) as total, COUNT(col) as non_null, COUNT(DISTINCT col) as unique_count,
  //        MIN(col), MAX(col), AVG(col), MEDIAN(col), STDDEV(col)
  // FROM table

  // Per colonne categoriche:
  // SELECT col as value, COUNT(*) as count FROM table GROUP BY col ORDER BY count DESC LIMIT 20

  // Per entrambi:
  // Null count = total - non_null
  // Null % = (total - non_null) / total * 100
}
```

Tipo di ritorno:
```typescript
interface ColumnProfile {
  columnName: string;
  columnType: string;
  totalRows: number;
  nonNullCount: number;
  uniqueCount: number;
  nullPercent: number;
  // Numerico:
  min?: string;
  max?: string;
  mean?: string;
  median?: string;
  stddev?: string;
  // Distribuzione (per il grafico):
  distribution: { label: string; count: number }[];
}
```

Per la distribuzione:
- Numerico: `SELECT FLOOR(col / bucket_size) * bucket_size as bucket, COUNT(*) FROM table GROUP BY 1 ORDER BY 1` (20 bucket)
- Categorico: `SELECT col, COUNT(*) FROM table GROUP BY col ORDER BY COUNT(*) DESC LIMIT 20`

### Step 2: Messaggio e handler

Nuovo messaggio webview → extension:
```typescript
| { type: 'profileColumn'; columnIndex: number }
```

Handler in `BasePanel`:
```typescript
case 'profileColumn':
  return this.handleProfileColumn(message.columnIndex);
```

`handleProfileColumn` calcola il profilo e apre il `ColumnProfilePanel`.

### Step 3: ColumnProfilePanel (side panel)

Nuovo panel simile a `QueryResultPanel`:
- Webview a lato (`ViewColumn.Beside`)
- HTML con: stats in alto (tabella key-value) + canvas per il grafico sotto
- Usa uPlot o Chart.js per renderizzare il grafico
- Il panel riceve i dati via `postMessage` dal backend

HTML template (`buildProfileHtml.ts`):
```html
<div id="profile">
  <h3 id="columnName">Column: age</h3>
  <div id="statsGrid">
    <!-- key-value pairs: Type, Count, Unique, Null%, Min, Max, Mean, Median -->
  </div>
  <canvas id="chart"></canvas>
</div>
```

### Step 4: Frontend — Bottone 📊 nell'header

In `renderer.js`, dentro `createHeaderRow()`, aggiungere un bottone accanto al filter button:

```javascript
const profileBtn = document.createElement('button');
profileBtn.className = 'profile-btn';
profileBtn.dataset.columnIndex = i;
profileBtn.innerHTML = '<svg>...</svg>'; // icona grafico a barre
th.appendChild(profileBtn);
```

Click handler (delegato su document, come il filter button):
```javascript
document.addEventListener('click', (e) => {
  const profileBtn = e.target.closest('.profile-btn');
  if (!profileBtn) { return; }
  const colIdx = parseInt(profileBtn.dataset.columnIndex, 10);
  sendMessage({ type: 'profileColumn', columnIndex: colIdx });
});
```

### Step 5: Selection stats bar

Una barra fissa sotto la tabella che mostra statistiche sulla selezione corrente.

Quando l'utente seleziona celle:
1. Il frontend raccoglie i valori selezionati dal DataWindow
2. Calcola localmente (senza query backend): count, sum, avg, min, max
3. Mostra nella barra: `Count: 150 | Sum: 45,230 | Avg: 301.5 | Min: 12 | Max: 1,450`

Solo per valori numerici. Se la selezione contiene testo, mostra solo Count.

HTML:
```html
<div id="selectionStats" class="selection-stats hidden">
  <span>Count: <b>0</b></span>
  <span>Sum: <b>0</b></span>
  <span>Avg: <b>0</b></span>
  <span>Min: <b>0</b></span>
  <span>Max: <b>0</b></span>
</div>
```

Aggiornamento: su ogni cambio di selezione (`applyHighlights`), ricalcola le stats.

### Step 6: Libreria chart

Installare uPlot:
```bash
npm install uplot
```

Oppure usare Chart.js:
```bash
npm install chart.js
```

La libreria viene bundlata nel webview del `ColumnProfilePanel` (non nel main webview — solo nel side panel).

### Step 7: Tipo di grafico automatico

Il backend determina il tipo di grafico in base al tipo colonna:
- `BIGINT`, `DOUBLE`, `INTEGER`, `FLOAT` → **Histogram** (distribuzione in bucket)
- `VARCHAR`, `BOOLEAN` → **Bar chart** (top 20 valori per frequenza)
- `DATE`, `TIMESTAMP` → **Line chart** (conteggio per periodo)

Il frontend riceve `distribution[]` + `chartType` e renderizza di conseguenza.

## File coinvolti

| File | Modifica |
|------|----------|
| `src/services/TableManager.ts` | Nuovo metodo `getColumnProfile()` |
| `src/types/index.ts` | Nuovo tipo `ColumnProfile`, nuovo messaggio `profileColumn` |
| `src/panels/BasePanel.ts` | Handler `handleProfileColumn` |
| `src/panels/ColumnProfilePanel.ts` | **NUOVO** — side panel per profiling |
| `src/panels/buildProfileHtml.ts` | **NUOVO** — HTML template |
| `media/src/ui/renderer.js` | Aggiungere bottone 📊 nell'header |
| `media/src/main.js` | Click handler per profile button |
| `media/src/workspace-main.js` | Stesso click handler |
| `media/src/ui/selection-stats.js` | **NUOVO** — calcolo e rendering stats selezione |
| `media/styles.css` | Stili per profile button, selection stats bar |
| `package.json` | Aggiungere dipendenza chart (uPlot o chart.js) |

## Scelta grafico: Chart.js vs uPlot

**Raccomandazione: Chart.js**
- Più tipi di grafico (bar, line, pie, scatter, histogram)
- API più semplice
- 70KB (accettabile per un side panel)
- Supporta CSP con nonce
- Documentazione eccellente

uPlot è più leggero (30KB) ma supporta solo line/bar/scatter — manca l'histogram nativo.

## Note

- Il profiling funziona sulla `getEffectiveTable()` — se c'è una query inline attiva, profila i risultati della query
- La selection stats bar è puramente frontend (calcolo locale sui dati in cache nel DataWindow) — nessuna query backend
- Il side panel profiling richiede una query backend (per avere stats precise su tutto il dataset, non solo le righe in cache)
