import { EventEmitter } from "node:events";
import type { BaseEvent, EventType } from "./eventTypes.js";

/**
 * Thin wrapper around Node's EventEmitter standing in for AWS
 * EventBridge in local/dev. Production would swap this
 * implementation for an EventBridge client with the same publish/
 * subscribe surface -- consumers (state machines, the orchestrator
 * in Phase 3) never talk to EventBridge/EventEmitter directly.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // World-state events fan out to multiple subscribers (state
    // machines, agents, dashboard subscriptions) -- raise the
    // default cap rather than silently dropping listeners.
    this.emitter.setMaxListeners(50);
  }

  publish(event: BaseEvent): void {
    this.emitter.emit(event.eventType, event);
    this.emitter.emit("*", event);
  }

  subscribe(eventType: EventType | "*", handler: (event: BaseEvent) => void): () => void {
    this.emitter.on(eventType, handler);
    return () => this.emitter.off(eventType, handler);
  }
}
