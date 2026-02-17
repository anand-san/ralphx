import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EventType, RalphxEvent } from "./types";

type EventListener = (event: RalphxEvent) => void;

export class EventBus {
  private listeners = new Map<EventType | "*", Set<EventListener>>();
  private eventsPath: string | null = null;

  /**
   * Set the events.jsonl path. All events will be appended to this file.
   * Must be called before emitting events if file persistence is desired.
   */
  setEventsPath(path: string): void {
    this.eventsPath = path;
  }

  on(type: EventType | "*", listener: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  off(type: EventType | "*", listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  async emit(event: RalphxEvent): Promise<void> {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.listeners.get("*");
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        listener(event);
      }
    }

    // Persist to events.jsonl
    if (this.eventsPath) {
      await this.appendToFile(event);
    }
  }

  private async appendToFile(event: RalphxEvent): Promise<void> {
    if (!this.eventsPath) return;
    await mkdir(dirname(this.eventsPath), { recursive: true });
    await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

// Singleton for the run
let globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

export function resetEventBus(): void {
  if (globalBus) {
    globalBus.removeAllListeners();
  }
  globalBus = null;
}
