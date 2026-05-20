/**
 * Application state machine instance.
 *
 * Centralizes UI state transitions. Modules call transitionTo() instead of
 * setting individual boolean flags. The onChange callback updates the UI
 * (enabling/disabling buttons, showing/hiding elements).
 */

import { createStateMachine } from './ui-state-machine.js';

/** @type {ReturnType<typeof createStateMachine>} */
const machine = createStateMachine((newState, oldState) => {
  // UI side effects on state change
  const queryInput = document.getElementById('queryInput');
  const runBtn = document.getElementById('queryRunBtn');
  const sideBtn = document.getElementById('querySideBtn');
  const clearBtn = document.getElementById('queryClearBtn');

  // Disable all inputs during LOADING
  if (newState === 'LOADING') {
    if (runBtn) { runBtn.disabled = true; }
    if (sideBtn) { sideBtn.disabled = true; }
    if (clearBtn) { clearBtn.disabled = true; }
    if (queryInput) { queryInput.disabled = true; }
  }

  // Re-enable on READY
  if (newState === 'READY' && oldState === 'LOADING') {
    if (runBtn) { runBtn.disabled = false; }
    if (sideBtn) { sideBtn.disabled = false; }
    if (clearBtn) { clearBtn.disabled = false; }
    if (queryInput) { queryInput.disabled = false; }
  }
});

export function getUIState() { return machine.getState(); }
export function transitionTo(state) { return machine.transition(state); }
export function canTransitionTo(state) { return machine.canTransition(state); }
export function resetUIState(state) { machine.reset(state); }
