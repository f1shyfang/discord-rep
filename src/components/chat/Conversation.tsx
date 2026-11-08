import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type RouterOutputs } from "~/utils/api";
import type { Profile } from "./AuthGate";
import { Avatar, Empty, ErrorNotice, Modal } from "./Primitives";
import { MessageBody } from "./MessageBody";
import { useConversationEvents } from "./useConversationEvents";
import { P } from "~/server/chat/permissions";

type Message = RouterOutputs["messages"]["list"]["items"][number];
export function Conversation({
  conversationId,
  name,
  profile,
  readSeq,
  people = [],
}: {
  conversationId: string;
  name: string;
  profile: Profile;
  readSeq: string;
  people?: { id: string; displayName: string }[];
}) {
  const utils = api.useUtils();
  const live = useConversationEvents(conversationId);
  const history = api.messages.list.useInfiniteQuery(
    { conversationId },
    {
      getNextPageParam: (page) => page.before ?? undefined,
      refetchInterval: live.connected ? false : 5000,
      retry: false,
    },
  );
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [jumpId, setJumpId] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [online, setOnline] = useState(true);
  const [initialRead, setInitialRead] = useState<string | null>(null);
  const snapshotRead = history.data?.pages[0]?.lastReadSeq;
  // Capture the boundary once the initial conversation snapshot arrives. Sidebar
  // summaries load independently and can still be missing on a cold deep link.
  if (initialRead === null && snapshotRead !== undefined)
    setInitialRead(snapshotRead);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const lastAck = useRef(readSeq);
  const lastAttempt = useRef<{
    body: string;
    replyToId?: string;
    clientNonce: string;
  } | null>(null);
  const oldHeight = useRef<number | null>(null);
  const searchResults = api.search.messages.useInfiniteQuery(
    { conversationId, query: search },
    {
      enabled: search.length >= 2,
      getNextPageParam: (page) => page.before ?? undefined,
      retry: false,
    },
  );
  const around = api.messages.around.useQuery(
    { conversationId, messageId: jumpId },
    { enabled: !!jumpId, retry: false },
  );
  const prefs = api.preferences.get.useQuery({ conversationId });
  const preference = api.preferences.set.useMutation({
    onSuccess: () => void utils.preferences.invalidate(),
  });
  const typists = api.activity.typists.useQuery(
    { conversationId },
    { refetchInterval: 3000, retry: false },
  );
  const typing = api.activity.typing.useMutation();
  const reads = api.reads.ack.useMutation({
    onSuccess: () => void utils.reads.summary.invalidate(),
  });
  const refresh = () => {
    void utils.messages.invalidate();
    void utils.search.invalidate();
  };
  const send = api.messages.send.useMutation({
    onSuccess: () => {
      setBody("");
      setReply(null);
      lastAttempt.current = null;
      setAtBottom(true);
      refresh();
      typing.mutate({ conversationId, active: false });
    },
  });
  const edit = api.messages.edit.useMutation({
    onSuccess: () => {
      setEditing(null);
      setBody("");
      refresh();
    },
  });
  const remove = api.messages.delete.useMutation({
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const react = api.messages.react.useMutation({ onSuccess: refresh });
  const pages = history.data?.pages ?? [];
  const items = jumpId
    ? (around.data ?? [])
    : [...pages].reverse().flatMap((page) => page.items);
  const latestSeq = pages[0]?.latestSeq ?? "0";
  const permissions = pages[0]?.permissions ?? 0;
  const canSend =
    !!(permissions & P.SEND_MESSAGES) &&
    !history.error &&
    !live.revoked &&
    online;
  const allPeople = [
    ...people,
    { id: profile.id, displayName: profile.displayName },
  ];
  const lastItem = items.at(-1);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    changed();
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    if (!timeline.current) return;
    if (oldHeight.current !== null) {
      timeline.current.scrollTop +=
        timeline.current.scrollHeight - oldHeight.current;
      oldHeight.current = null;
    } else if (atBottom && !jumpId)
      timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [lastItem?.id, items.length, atBottom, jumpId]);
  useEffect(() => {
    if (jumpId)
      document
        .getElementById(`message-${jumpId}`)
        ?.scrollIntoView({ block: "center" });
  }, [jumpId, around.data]);
  useEffect(() => {
    const ack = () => {
      if (
        atBottom &&
        !jumpId &&
        !history.error &&
        lastItem?.seq === latestSeq &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        BigInt(latestSeq) > BigInt(lastAck.current)
      ) {
        lastAck.current = latestSeq;
        reads.mutate(
          { conversationId, seq: latestSeq },
          {
            onError: () => {
              lastAck.current = "0";
            },
          },
        );
      }
    };
    ack();
    window.addEventListener("focus", ack);
    document.addEventListener("visibilitychange", ack);
    return () => {
      window.removeEventListener("focus", ack);
      document.removeEventListener("visibilitychange", ack);
    };
    // The mutation function is stable; the result object isn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    atBottom,
    jumpId,
    history.error,
    lastItem?.seq,
    latestSeq,
    conversationId,
  ]);
  const submit = () => {
    if (!body.trim() || !canSend || send.isPending || edit.isPending) return;
    if (editing) {
      edit.mutate({
        messageId: editing.id,
        expectedVersion: editing.version,
        body,
      });
      return;
    }
    const replyToId = reply?.id;
    const previous = lastAttempt.current;
    const input =
      previous?.body === body && previous.replyToId === replyToId
        ? previous
        : { body, replyToId, clientNonce: crypto.randomUUID() };
    lastAttempt.current = input;
    send.mutate({ conversationId, ...input });
  };
  const keyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      setReply(null);
      if (editing) {
        setEditing(null);
        setBody("");
      }
    }
    if (event.key === "ArrowUp" && !body) {
      const own = [...items]
        .reverse()
        .find((m) => m.authorId === profile.id && !m.deletedAt);
      if (own) {
        setEditing(own);
        setBody(own.body);
      }
    }
  };
  const startEdit = (m: Message) => {
    setEditing(m);
    setReply(null);
    setBody(m.body);
    composer.current?.focus();
  };
  return (
    <div className="conversation-content">
      {live.revoked && (
        <div className="connection-banner" role="alert">
          Access to this conversation was removed.
        </div>
      )}
      <div className="conversation-tools">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
        >
          <input
            aria-label="Search this conversation"
            type="search"
            placeholder={`Search ${name}`}
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button>Search</button>
          {search && !live.revoked && !history.error && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              Clear
            </button>
          )}
        </form>
        <label className="notification-label">
          Notifications
          <select
            aria-label="Conversation notifications"
            value={prefs.data?.notificationMode ?? "all"}
            onChange={(e) =>
              preference.mutate({
                conversationId,
                notificationMode: e.target.value as "all" | "mentions" | "none",
              })
            }
          >
            <option value="all">All messages</option>
            <option value="mentions">Mentions only</option>
            <option value="none">Muted</option>
          </select>
        </label>
      </div>
      {(!online || history.error) && (
        <div className="connection-banner" role="status">
          {!online
            ? "You’re offline. Your draft stays here until you reconnect."
            : "Couldn’t refresh this conversation."}
          <button onClick={() => void history.refetch()}>Reconnect</button>
        </div>
      )}
      <ErrorNotice
        error={history.error ?? edit.error ?? react.error ?? preference.error}
      />
      {search && !live.revoked && !history.error && (
        <section className="search-results" aria-label="Search results">
          <strong>Results for “{search}”</strong>
          <ErrorNotice error={searchResults.error} />
          {searchResults.isFetching && <p role="status">Searching…</p>}
          {searchResults.data?.pages
            .flatMap((p) => p.items)
            .map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setJumpId(m.id);
                  setAtBottom(false);
                }}
              >
                <strong>{m.author.displayName}</strong> {m.body}
              </button>
            ))}
          {searchResults.data?.pages[0]?.items.length === 0 && (
            <p>No messages found.</p>
          )}
          {searchResults.hasNextPage && (
            <button
              disabled={searchResults.isFetchingNextPage}
              onClick={() => void searchResults.fetchNextPage()}
            >
              More results
            </button>
          )}
        </section>
      )}
      {jumpId && !live.revoked && !history.error && (
        <div className="connection-banner">
          Viewing message context{" "}
          <button
            onClick={() => {
              setJumpId("");
              setAtBottom(true);
            }}
          >
            Return to latest
          </button>
          <ErrorNotice error={around.error} />
        </div>
      )}
      <div
        className="timeline"
        ref={timeline}
        role="log"
        aria-label={`Messages in ${name}`}
        aria-live="off"
        onScroll={() => {
          const t = timeline.current;
          if (!t) return;
          const bottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
          setAtBottom(bottom);
        }}
      >
        {history.isPending ? (
          <p className="padded" role="status">
            Loading messages…
          </p>
        ) : history.error || live.revoked ? null : (
          <>
            {!jumpId && history.hasNextPage && (
              <button
                className="load-older"
                disabled={history.isFetchingNextPage}
                onClick={() => {
                  oldHeight.current = timeline.current?.scrollHeight ?? null;
                  void history.fetchNextPage();
                }}
              >
                {" "}
                {history.isFetchingNextPage
                  ? "Loading…"
                  : "Load earlier messages"}
              </button>
            )}
            {!items.length && (
              <Empty title={`Welcome to ${name}`}>
                <p>This is the beginning of your conversation. Say hello.</p>
              </Empty>
            )}
            {items.map((m, index) => {
              const previous = items[index - 1];
              const date = m.createdAt.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              });
              const newDay =
                !previous ||
                previous.createdAt.toDateString() !==
                  m.createdAt.toDateString();
              const unread =
                initialRead !== null &&
                BigInt(m.seq) > BigInt(initialRead) &&
                (!previous || BigInt(previous.seq) <= BigInt(initialRead));
              const grouped =
                !newDay &&
                !unread &&
                !m.replyToId &&
                previous?.authorId === m.authorId &&
                m.createdAt.getTime() - previous.createdAt.getTime() < 300000;
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="date-divider">
                      <span>{date}</span>
                    </div>
                  )}
                  {unread && initialRead !== "0" && (
                    <div className="unread-divider">New messages</div>
                  )}
                  <article
                    id={`message-${m.id}`}
                    className={`message-row ${grouped ? "grouped" : ""} ${m.id === jumpId ? "highlight-message" : ""}`}
                  >
                    {!grouped ? (
                      <Avatar name={m.author.displayName} />
                    ) : (
                      <span className="continuation-time">
                        {m.createdAt.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    <div className="message-content">
                      {!grouped && (
                        <div className="message-meta">
                          <strong>{m.author.displayName}</strong>
                          <time
                            dateTime={m.createdAt.toISOString()}
                            title={m.createdAt.toLocaleString()}
                          >
                            {m.createdAt.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      )}
                      {m.replyToId && (
                        <button
                          className="reply-reference"
                          onClick={() => {
                            setJumpId(m.replyToId!);
                            setAtBottom(false);
                          }}
                        >
                          ↳ Reply to{" "}
                          {items.find((x) => x.id === m.replyToId)?.author
                            .displayName ?? "a message"}
                        </button>
                      )}
                      {m.deletedAt ? (
                        <p className="deleted-message">Message deleted</p>
                      ) : m.blocked ? (
                        <details>
                          <summary>Message from a blocked person</summary>
                          <MessageBody body={m.body} people={allPeople} />
                        </details>
                      ) : (
                        <>
                          <MessageBody body={m.body} people={allPeople} />
                          {m.editedAt && (
                            <span className="edited-marker">(edited)</span>
                          )}
                        </>
                      )}
                      {!m.deletedAt && (
                        <div className="reactions">
                          {m.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              aria-label={`${r.emoji}, ${r.count} reactions`}
                              aria-pressed={r.mine}
                              className={r.mine ? "mine" : ""}
                              disabled={!(permissions & P.ADD_REACTIONS)}
                              onClick={() =>
                                react.mutate({
                                  messageId: m.id,
                                  emoji: r.emoji,
                                  present: !r.mine,
                                })
                              }
                            >
                              {r.emoji} {r.count}
                            </button>
                          ))}
                        </div>
                      )}
                      {emojiFor === m.id && (
                        <div
                          className="emoji-picker"
                          aria-label="Choose reaction"
                        >
                          {["👍", "❤️", "😂", "🎉", "👀", "😮", "🔥"].map(
                            (emoji) => (
                              <button
                                key={emoji}
                                aria-label={`React ${emoji}`}
                                onClick={() => {
                                  react.mutate({
                                    messageId: m.id,
                                    emoji,
                                    present: true,
                                  });
                                  setEmojiFor(null);
                                }}
                              >
                                {emoji}
                              </button>
                            ),
                          )}
                          <button
                            onClick={() => setEmojiFor(null)}
                            aria-label="Close reaction picker"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                    {!m.deletedAt && (
                      <div className="message-actions">
                        {!!(permissions & P.ADD_REACTIONS) && (
                          <button
                            title="Add reaction"
                            aria-label="Add reaction"
                            onClick={() =>
                              setEmojiFor(emojiFor === m.id ? null : m.id)
                            }
                          >
                            ☺
                          </button>
                        )}
                        {canSend && (
                          <button
                            title="Reply"
                            onClick={() => {
                              setReply(m);
                              setEditing(null);
                              composer.current?.focus();
                            }}
                          >
                            Reply
                          </button>
                        )}
                        {m.authorId === profile.id && canSend && (
                          <button onClick={() => startEdit(m)}>Edit</button>
                        )}
                        {(m.authorId === profile.id ||
                          !!(permissions & P.MANAGE_MESSAGES)) && (
                          <button
                            className="danger"
                            onClick={() => setDeleting(m)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
            {send.isPending && (
              <article className="message-row pending-message">
                <Avatar name={profile.displayName} />
                <div>
                  <strong>{profile.displayName}</strong>
                  <MessageBody
                    body={send.variables?.body ?? body}
                    people={allPeople}
                  />
                  <small>Sending…</small>
                </div>
              </article>
            )}
          </>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {lastItem && lastItem.authorId !== profile.id
          ? `Latest message from ${lastItem.author.displayName}`
          : ""}
      </span>
      {!atBottom && !jumpId && (
        <button
          className="new-messages"
          onClick={() => {
            setAtBottom(true);
          }}
        >
          Jump to latest ↓
        </button>
      )}
      <div className="composer-area">
        {reply && (
          <div className="composer-context">
            Replying to <strong>{reply.author.displayName}</strong>
            <button aria-label="Cancel reply" onClick={() => setReply(null)}>
              ×
            </button>
          </div>
        )}
        {editing && (
          <div className="composer-context">
            Editing your message
            <button
              onClick={() => {
                setEditing(null);
                setBody("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <ErrorNotice error={send.error} />
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={composer}
            aria-label={`Message ${name}`}
            placeholder={
              canSend
                ? `Message ${name}`
                : !online
                  ? "Reconnect to send a message"
                  : "You can read this conversation"
            }
            value={body}
            maxLength={4000}
            disabled={!canSend || send.isPending}
            rows={1}
            onKeyDown={keyboard}
            onChange={(e) => {
              setBody(e.target.value);
              if (Date.now() - lastTyping.current > 3000) {
                lastTyping.current = Date.now();
                typing.mutate({ conversationId, active: true });
              }
            }}
          />
          {people.length > 0 && (
            <select
              className="mention-picker"
              aria-label="Mention someone"
              value=""
              disabled={!canSend}
              onChange={(e) => {
                setBody((b) => `${b}<@${e.target.value}> `);
                composer.current?.focus();
              }}
            >
              <option value="">@</option>
              {people.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            className="send-button"
            type="submit"
            disabled={
              !body.trim() || !canSend || send.isPending || edit.isPending
            }
          >
            {send.isPending
              ? "Sending…"
              : editing
                ? "Save"
                : send.error
                  ? "Retry"
                  : "Send"}
          </button>
        </form>
        <div className="composer-footer">
          <span role="status">
            {typists.data?.length
              ? `${typists.data.map((t) => t.displayName).join(", ")} typing…`
              : "Enter to send · Shift + Enter for a new line"}
          </span>
          <span>{Array.from(body).length}/2000</span>
        </div>
      </div>
      {deleting && (
        <Modal title="Delete message?" onClose={() => setDeleting(null)}>
          <p>This removes the message for everyone.</p>
          <blockquote>{deleting.body}</blockquote>
          <ErrorNotice error={remove.error} />
          <button
            className="danger-button"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({
                messageId: deleting.id,
                expectedVersion: deleting.version,
              })
            }
          >
            Delete message
          </button>
        </Modal>
      )}
    </div>
  );
}
