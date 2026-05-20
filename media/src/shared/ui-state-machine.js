/**
 * UI State Machine — manages frontend UI states with explicit transitions.
 *
 * States: IDLE | LOADING | READY | EDITING | QUERY_RUNNING | QUERY_ACTIVE | SORTING
 *
 * Each state defines what's enabled/disabled. Invalid combinations are prevented
 * by only allowing defined transitions.
 */

/** @typedef {'IDLE'|'LOADING'|'READY'|'EDITING'|'QUERY_RUNNING'|'QUERY_ACTIVE'|'SORTING'} UIState */

const TRANSITIONS = {
  IDLE: ['LOADING'],
  LOADING: ['READY', 'IDLE'],
  READY: ['LOADING', 'EDITING', 'QUERY_RUNNING', 'SORTING', 'QUERY_ACTIVE'],
  EDITING: ['READY'],
  QUERY_RUNNING: ['QUERY_ACTIVE', 'READY'],
  QUERY_ACTIVE: ['READY', 'SORTING', 'QUERY_RUNNING', 'LOADING'],
  SORTING: ['READY', 'QUERY_ACTIVE'],
};

/**
 * Create a UI state machine.
 * @param {function} onChange - callback(newState, oldState) called on every transition
 * @returns {{ getState, transition, canTransition }}
 */
export function createStateMachine(onChange) {
  /** @type {UIState} */
  let current = 'IDLE';

  return {
    getState() { return current; },

    /**
     * Attempt a state transition. Returns true if successful.
     * @param {UIState} newState
     * @returns {boolean}
     */
    transition(newState) {
      if (current === newState) { return true; }
      const allowed = TRANSITIONS[current];
      if (!allowed || !allowed.includes(newState)) { return false; }
      const old = current;
      current = newState;
      if (onChange) { onChange(current, old); }
      return true;
    },

    /**
     * Check if a transition is valid without performing it.
     * @param {UIState} newState
     * @returns {boolean}
     */
    canTransition(newState) {
      if (current === newState) { return true; }
      const allowed = TRANSITIONS[current];
      return !!(allowed && allowed.includes(newState));
    },

    /** Force state (for initialization/reset). */
    reset(state = 'IDLE') {
      const old = current;
      current = state;
      if (onChange) { onChange(current, old); }
    },
  };
}
