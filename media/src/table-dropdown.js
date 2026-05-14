/**
 * Table dropdown — switch active table in workspace.
 */

import { sendMessage } from './messaging.js';

export function updateTableDropdown(tables, activeTable) {
  const dropdown = document.getElementById('tableDropdown');
  if (!dropdown) { return; }

  dropdown.innerHTML = '';

  if (tables.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No tables loaded';
    dropdown.appendChild(opt);
    return;
  }

  tables.forEach(table => {
    const opt = document.createElement('option');
    opt.value = table.name;
    opt.textContent = `${table.name} (${table.rowCount} rows)`;
    opt.selected = table.name === activeTable;
    dropdown.appendChild(opt);
  });
}

export function bindTableDropdown() {
  const dropdown = document.getElementById('tableDropdown');
  if (!dropdown) { return; }

  dropdown.addEventListener('change', (e) => {
    const tableName = e.target.value;
    if (tableName) {
      sendMessage({ type: 'switchTable', tableName });
    }
  });
}
