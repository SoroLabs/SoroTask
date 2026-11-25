import type { FlowEvent, FlowSession, FlowTransition, PrefetchConfig, TransitionMatrix } from "./types";

export class FlowTracker {
  private events: FlowEvent[] = [];
  private session: FlowSession;
  private config: PrefetchConfig;

  constructor(config: PrefetchConfig) {
    this.config = config;
    this.session = this.createSession();
    this.load();
  }

  private createSession(): FlowSession {
    return {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      events: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      currentRoute: null,
    };
  }

  recordNavigation(from: string | null, to: string): FlowEvent {
    const event: FlowEvent = {
      from,
      to,
      timestamp: Date.now(),
    };

    this.events.push(event);
    this.session.events.push(event);
    this.session.currentRoute = to;
    this.session.lastActivityAt = Date.now();

    this.trim();
    this.save();

    return event;
  }

  recordPageLoad(route: string): void {
    this.session.currentRoute = route;
    this.session.lastActivityAt = Date.now();
  }

  getEvents(): FlowEvent[] {
    return [...this.events];
  }

  getSessionEvents(): FlowEvent[] {
    return [...this.session.events];
  }

  getSession(): FlowSession {
    return { ...this.session };
  }

  getTransitions(): FlowTransition[] {
    const matrix = this.getTransitionMatrix();
    const transitions: FlowTransition[] = [];

    for (const [from, tos] of Object.entries(matrix)) {
      for (const [to, count] of Object.entries(tos)) {
        transitions.push({ from, to, count });
      }
    }

    return transitions.sort((a, b) => b.count - a.count);
  }

  getTransitionMatrix(): TransitionMatrix {
    const matrix: TransitionMatrix = {};

    for (const event of this.events) {
      if (event.from === null) continue;
      if (!matrix[event.from]) {
        matrix[event.from] = {};
      }
      matrix[event.from][event.to] = (matrix[event.from][event.to] || 0) + 1;
    }

    return matrix;
  }

  getCurrentRoute(): string | null {
    return this.session.currentRoute;
  }

  getTotalEvents(): number {
    return this.events.length;
  }

  reset(): void {
    this.events = [];
    this.session = this.createSession();
    this.save();
  }

  resetSession(): void {
    this.session = this.createSession();
  }

  private trim(): void {
    if (this.events.length > this.config.maxHistoryLength) {
      this.events = this.events.slice(-this.config.maxHistoryLength);
    }
  }

  private getStorageKey(): string {
    return `${this.config.storageKey}.events`;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.getStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as FlowEvent[];
        if (Array.isArray(parsed)) {
          this.events = parsed;
        }
      }
    } catch {
      this.events = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(this.events));
    } catch {
    }
  }
}
