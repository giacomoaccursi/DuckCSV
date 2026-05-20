/**
 * Column filter dropdown: shows unique values with checkboxes.
 * Search queries the backend with debounce for large datasets.
 */

import { state } from './state.js';
import { sendMessage } from './messaging.js';

const SEARCH_DEBOUNCE_MS = 300;

let activeDropdown = null;
let activeColumnIndex = -1;
let selectionSet = new Set();
let allLoadedValues = [];

export function openFilterDropdown(columnIndex, anchorEl) {
  closeFilterDropdown();

  activeColumnIndex = columnIndex;
  selectionSet = new Set(state.filters[columnIndex] || []);

  sendMessage({ type: 'getColumnValues', columnIndex });

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
  if (!activeDropdown) { return; }
  if (activeColumnIndex !== data.columnIndex) { return; }
  allLoadedValues = data.values;
  renderContent(data.columnIndex, data.values);
}

export function closeFilterDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
  activeColumnIndex = -1;
  allLoadedValues = [];
  document.removeEventListener('mousedown', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.filter-btn')) {
    closeFilterDropdown();
  }
}

function renderContent(columnIndex, values) {
  if (!activeDropdown) { return; }

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
  activeDropdown.appendChild(list);

  // Apply button
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary btn-sm filter-apply-btn';
  applyBtn.textContent = 'Apply';
  activeDropdown.appendChild(applyBtn);

  // Render the list of values
  function renderList(vals) {
    list.innerHTML = '';
    vals.forEach(value => {
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

    if (vals.length === 0) {
      list.innerHTML = '<div class="filter-no-results">No matching values</div>';
    }
  }

  renderList(values);

  // Search with backend debounce
  let searchTimeout = null;
  searchBox.addEventListener('input', () => {
    const term = searchBox.value.trim();
    if (searchTimeout) { clearTimeout(searchTimeout); }

    if (!term) {
      // Empty search: show the initial values
      renderList(allLoadedValues);
      return;
    }

    searchTimeout = setTimeout(() => {
      // Query backend for matching values
      sendMessage({ type: 'searchColumnValues', columnIndex, term });
    }, SEARCH_DEBOUNCE_MS);
  });

  // Select All / Clear operate on currently visible values
  selectAllBtn.addEventListener('click', () => {
    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { cb.checked = true; selectionSet.add(cb.value); });
  });
  clearBtn.addEventListener('click', () => {
    selectionSet.clear();
    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { cb.checked = false; });
  });

  applyBtn.addEventListener('click', () => {
    const newFilters = { ...state.filters };
    if (selectionSet.size === 0) {
      delete newFilters[columnIndex];
    } else {
      newFilters[columnIndex] = Array.from(selectionSet);
    }
    sendMessage({ type: 'setFilters', filters: newFilters });
    closeFilterDropdown();
  });

  searchBox.focus();
}
