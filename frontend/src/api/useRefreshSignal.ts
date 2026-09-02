import { useEffect, useRef, useState } from "react";
import { wsUrl } from "./client.js";

/**
 * Connects to the dashboard API's WebSocket refresh channel (the
 * local stand-in for Supabase Realtime subscriptions -- see
 * core/src/api/dashboard.ts). Every message just means "something
 * changed, refetch" -- returns a version counter that pages watch in
 * their fetch effect's dependency array, and a lastEventAt timestamp
 * for a small "live" indicator.
 */
export function useRefreshSignal() {
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;

    function connect() {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => !cancelled && setConnected(true);
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retryRef.current = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (evt) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(evt.data as string);
          setLastEventAt(msg.at ?? new Date().toISOString());
        } catch {
          setLastEventAt(new Date().toISOString());
        }
        setVersion((v) => v + 1);
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      socket?.close();
    };
  }, []);

  return { version, connected, lastEventAt };
}
