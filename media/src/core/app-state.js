/**
 * Application state machine — single source of truth for UI state.
 *
 * Replaces scattered boolean flags (queryRunning, queryActive, isSorting, systemLoading)
 * with explicit state transitions. Modules query state via exported functions.
 *
 * States: IDLE | LOADING | READY | EDITING | QUERY_RUNNING | QUERY_ACTIVE | SORTING
 */

import { createStateMachine } from '../shared/ui-state-machine.js';
import { dom } from './dom.js';
import { toggle } from './utils.js';

const machine = createStateMachine((newState, oldState) => {
  applyUIEffects(newState, oldState);
});

// ─── State Queries (replace old boolean flags) ───────────────────────────────

export function getUIState() { return machine.getState(); }
export function isQueryRunning() { return machine.getState() === 'QUERY_RUNNING'; }
export function isQueryActive() { return machine.getState() === 'QUERY_ACTIVE'; }
export function isSystemLoading() { return machine.getState() === 'LOADING'; }
export function isSortingActive() { return machine.getState() === 'SORTING'; }

// ─── State Transitions (replace old setters) ─────────────────────────────────

export function setQueryRunning(running) {
  if (running) {
    machine.transition('QUERY_RUNNING');
  } else {
    // When stopping a query, go back to READY (or QUERY_ACTIVE if results arrived)
    if (machine.getState() === 'QUERY_RUNNING') {
      machine.transition('READY');
    }
  }
}

export function setQueryActive(active) {
  if (active) {
    machine.transition('QUERY_ACTIVE');
  } else {
    if (machine.getState() === 'QUERY_ACTIVE') {
      machine.transition('READY');
    }
  }
}

export function setSystemLoading(loading) {
  if (loading) {
    machine.transition('LOADING');
  } else {
    if (machine.getState() === 'LOADING') {
      machine.transition('READY');
    }
  }
}

export function setSorting(sorting) {
  if (sorting) {
    machine.transition('SORTING');
  } else {
    if (machine.getState() === 'SORTING') {
      machine.transition('READY');
    }
  }
}

export function setEditing(editing) {
  if (editing) {
    machine.transition('EDITING');
  } else {
    if (machine.getState() === 'EDITING') {
      machine.transition('READY');
    }
  }
}

/** Reset to READY (used when new data arrives). */
export function resetToReady() {
  machine.reset('READY');
}

/** Reset to IDLE (initial state). */
export function resetToIdle() {
  machine.reset('IDLE');
}

// ─── UI Side Effects ─────────────────────────────────────────────────────────

function applyUIEffects(newState, _oldState) {
  const runBtn = document.getElementById('queryRunBtn');
  const sideBtn = document.getElementById('querySideBtn');
  const clearBtn = document.getElementById('queryClearBtn');
  const queryInput = document.getElementById('queryInput');
  const exportBtn = document.getElementById('queryExportBtn');

  switch (newState) {
    case 'LOADING':
      if (runBtn) { runBtn.disabled = true; }
      if (sideBtn) { sideBtn.disabled = true; }
      if (clearBtn) { clearBtn.disabled = true; }
      if (queryInput) { queryInput.disabled = true; }
      break;

    case 'READY':
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2l10 6-10 6V2z"/></svg>';
        runBtn.title = 'Run query inline';
      }
      if (sideBtn) { sideBtn.disabled = false; }
      if (clearBtn) { clearBtn.disabled = false; }
      if (queryInput) { queryInput.disabled = false; }
      toggle(dom.queryClearBtn, false);
      toggle(exportBtn, false);
      break;

    case 'QUERY_RUNNING':
      if (runBtn) {
        runBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" class="spinner-stop"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20 20" class="spinner-ring"/><rect fill="currentColor" x="5.5" y="5.5" width="5" height="5"/></svg>';
        runBtn.title = 'Stop query';
        runBtn.disabled = false;
      }
      if (queryInput) { queryInput.disabled = true; }
      break;

    case 'QUERY_ACTIVE':
      if (runBtn) {
        runBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2l10 6-10 6V2z"/></svg>';
        runBtn.title = 'Run query inline';
        runBtn.disabled = false;
      }
      if (queryInput) { queryInput.disabled = false; }
      toggle(dom.queryClearBtn, true);
      toggle(exportBtn, true);
      break;

    case 'SORTING':
    case 'EDITING':
      // No specific UI changes needed — these block certain interactions
      break;
  }
}
