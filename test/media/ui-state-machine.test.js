/**
 * Tests for UI state machine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStateMachine } from '../../media/src/ui-state-machine.js';

describe('UI State Machine', () => {
  let machine;
  let transitions;

  beforeEach(() => {
    transitions = [];
    machine = createStateMachine((newState, oldState) => {
      transitions.push({ from: oldState, to: newState });
    });
  });

  it('starts in IDLE state', () => {
    expect(machine.getState()).toBe('IDLE');
  });

  it('allows IDLE → LOADING', () => {
    expect(machine.transition('LOADING')).toBe(true);
    expect(machine.getState()).toBe('LOADING');
  });

  it('blocks IDLE → READY (invalid transition)', () => {
    expect(machine.transition('READY')).toBe(false);
    expect(machine.getState()).toBe('IDLE');
  });

  it('allows LOADING → READY', () => {
    machine.transition('LOADING');
    expect(machine.transition('READY')).toBe(true);
    expect(machine.getState()).toBe('READY');
  });

  it('allows READY → EDITING', () => {
    machine.transition('LOADING');
    machine.transition('READY');
    expect(machine.transition('EDITING')).toBe(true);
    expect(machine.getState()).toBe('EDITING');
  });

  it('allows EDITING → READY', () => {
    machine.transition('LOADING');
    machine.transition('READY');
    machine.transition('EDITING');
    expect(machine.transition('READY')).toBe(true);
  });

  it('blocks EDITING → LOADING (invalid)', () => {
    machine.transition('LOADING');
    machine.transition('READY');
    machine.transition('EDITING');
    expect(machine.transition('LOADING')).toBe(false);
    expect(machine.getState()).toBe('EDITING');
  });

  it('allows READY → QUERY_RUNNING → QUERY_ACTIVE → READY', () => {
    machine.transition('LOADING');
    machine.transition('READY');
    expect(machine.transition('QUERY_RUNNING')).toBe(true);
    expect(machine.transition('QUERY_ACTIVE')).toBe(true);
    expect(machine.transition('READY')).toBe(true);
  });

  it('allows READY → SORTING → READY', () => {
    machine.transition('LOADING');
    machine.transition('READY');
    expect(machine.transition('SORTING')).toBe(true);
    expect(machine.transition('READY')).toBe(true);
  });

  it('calls onChange on valid transition', () => {
    machine.transition('LOADING');
    expect(transitions).toEqual([{ from: 'IDLE', to: 'LOADING' }]);
  });

  it('does not call onChange on invalid transition', () => {
    machine.transition('READY'); // invalid from IDLE
    expect(transitions).toEqual([]);
  });

  it('transition to same state returns true without callback', () => {
    machine.transition('LOADING');
    transitions = [];
    expect(machine.transition('LOADING')).toBe(true);
    expect(transitions).toEqual([]);
  });

  it('canTransition checks without performing', () => {
    expect(machine.canTransition('LOADING')).toBe(true);
    expect(machine.canTransition('READY')).toBe(false);
    expect(machine.getState()).toBe('IDLE'); // unchanged
  });

  it('reset forces state', () => {
    machine.reset('READY');
    expect(machine.getState()).toBe('READY');
    expect(transitions).toEqual([{ from: 'IDLE', to: 'READY' }]);
  });

  it('QUERY_ACTIVE allows SORTING', () => {
    machine.reset('QUERY_ACTIVE');
    transitions = [];
    expect(machine.transition('SORTING')).toBe(true);
  });

  it('SORTING allows QUERY_ACTIVE', () => {
    machine.reset('SORTING');
    transitions = [];
    expect(machine.transition('QUERY_ACTIVE')).toBe(true);
  });
});
