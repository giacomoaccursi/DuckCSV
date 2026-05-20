/**
 * Tables bar — shows loaded tables with remove buttons.
 */

import { sendMessage } from '../core/messaging.js';

const dom = {
  tablesBar: () => document.getElementById('tablesBar'),
  tablesBarList: () => document.getElementById('tablesBarList'),
};

export function renderTablesBar(tables) {
  const list = dom.tablesBarList();
  if (!list) { return; }

  list.innerHTML = '';

  if (tables.length === 0) {
    list.innerHTML = '<span class="tables-bar-empty">No tables loaded</span>';
    return;
  }

  tables.forEach(table => {
    const chip = document.createElement('div');
    chip.className = 'table-chip';
    chip.title = `${table.name} (${table.rowCount} rows) — ${table.headers.join(', ')}`;

    const name = document.createElement('span');
    name.className = 'table-chip-name';
    name.textContent = `${table.name} (${table.rowCount})`;
    chip.appendChild(name);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'table-chip-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove table';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'removeTable', tableName: table.name });
    });
    chip.appendChild(removeBtn);

    list.appendChild(chip);
  });
}
