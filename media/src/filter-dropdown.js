/**
 * Column filter dropdown: shows unique values with checkboxes.
 */

import { state } from './state.js';
import { sendMessage } from './messaging.js';

let activeDropdown = null;

export function openFilterDropdown(columnIndex, anchorEl) {
  closeFilterDropdown();

  sendMessage({ type: 'getColumnValues', columnIndex });
  state.columnValues = { columnIndex, values: null };

  const dropdown = document.createElement('div');
  dropdown.className = 'filter-dropdown';
  dropdown.dataset.columnIndex = columnIndex;

  const rect = anchorEl.closest('th').getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 'px';
  dropdown.innerHTML = '<div class="filter-dropdown-loading">Loading values...</div>';

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;

  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick);
  }, 0);
}

export function onColumnValuesReceived(data) {
  if (!activeDropdown || !state.columnValues) { return; }
  if (state.columnValues.columnIndex !== data.columnIndex) { return; }
  state.columnValues.values = data.values;
  renderContent(data.columnIndex, data.values);
}

export function closeFilterDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
  state.columnValues = null;
  document.removeEventListener('mousedown', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.filter-btn')) {
    closeFilterDropdown();
  }
}

function renderContent(columnIndex, values) {
  if (!activeDropdown) { return; }

  const currentSelection = state.filters[columnIndex] || [];
  const selectionSet = new Set(currentSelection);

  activeDropdown.innerHTML = '';

  // Search input
  const searchBox = document.createElement('input');
  searchBox.type = 'text';
  searchBox.className = 'filter-search';
  searchBox.placeholder = 'Search values...';
  activeDropdown.appendChild(searchBox);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'filter-btn-row';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'btn btn-sm';
  selectAllBtn.textContent = 'Select All';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-sm';
  clearBtn.textContent = 'Clear';

  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(clearBtn);
  activeDropdown.appendChild(btnRow);

  // Values list
  const list = document.createElement('div');
  list.className = 'filter-values-list';

  function renderList(filter) {
    list.innerHTML = '';
    const filtered = filter
      ? values.filter(v => v.toLowerCase().includes(filter.toLowerCase()))
      : values;

    filtered.forEach(value => {
      const item = document.createElement('label');
      item.className = 'filter-value-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = value;
      checkbox.checked = selectionSet.has(value);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) { selectionSet.add(value); }
        else { selectionSet.delete(value); }
      });

      const text = document.createElement('span');
      text.className = 'filter-value-text';
      text.textContent = value;
      text.title = value;

      item.appendChild(checkbox);
      item.appendChild(text);
      list.appendChild(item);
    });
  }

  renderList('');
  activeDropdown.appendChild(list);

  // Apply button
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary btn-sm filter-apply-btn';
  applyBtn.textContent = 'Apply';
  activeDropdown.appendChild(applyBtn);

  // Events
  searchBox.addEventListener('input', () => renderList(searchBox.value.trim()));
  selectAllBtn.addEventListener('click', () => { values.forEach(v => selectionSet.add(v)); renderList(searchBox.value.trim()); });
  clearBtn.addEventListener('click', () => { selectionSet.clear(); renderList(searchBox.value.trim()); });

  applyBtn.addEventListener('click', () => {
    const newFilters = { ...state.filters };
    if (selectionSet.size === 0 || selectionSet.size === values.length) {
      delete newFilters[columnIndex];
    } else {
      newFilters[columnIndex] = Array.from(selectionSet);
    }
    sendMessage({ type: 'setFilters', filters: newFilters });
    closeFilterDropdown();
  });

  searchBox.focus();
}
