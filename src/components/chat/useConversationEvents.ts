import { useEffect, useState } from "react";
import { api } from "~/utils/api";

export function useConversationEvents(conversationId: string) {
  const [connected, setConnected] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const utils = api.useUtils();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(
      `/api/chat-events?conversationId=${encodeURIComponent(conversationId)}`,
    );
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setConnected(true);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void utils.messages.list.invalidate({ conversationId });
        void utils.messages.around.invalidate();
        void utils.search.messages.invalidate({ conversationId });
        void utils.reads.summary.invalidate();
      }, 50);
    };
    source.addEventListener("ready", refresh);
    source.addEventListener("changed", refresh);
    source.addEventListener("revoked", () => {
      setRevoked(true);
      setConnected(false);
      source.close();
      void utils.messages.list.reset({ conversationId });
      void utils.messages.around.reset();
      void utils.servers.invalidate();
      void utils.users.bootstrap.invalidate();
    });
    source.onerror = () => setConnected(false);
    return () => {
      clearTimeout(refreshTimer);
      source.close();
    };
  }, [conversationId, utils]);
  return { connected, revoked };
}
