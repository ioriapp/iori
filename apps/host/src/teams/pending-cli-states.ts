/** CLI observations received while a child Terminal is being created. */
export class PendingCliStates<State> {
  readonly #states = new Map<string, State[]>();

  add(terminalId: string, state: State): void {
    let states = this.#states.get(terminalId);
    if (!states) this.#states.set(terminalId, (states = []));
    states.push(state);
  }

  take(terminalId: string): State[] {
    const states = this.#states.get(terminalId) ?? [];
    this.#states.delete(terminalId);
    return states;
  }

  clear(): void {
    this.#states.clear();
  }
}
