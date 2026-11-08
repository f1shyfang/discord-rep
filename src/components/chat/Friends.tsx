import { useState } from "react";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
import type { Profile } from "./AuthGate";
import { Avatar, Empty, ErrorNotice } from "./Primitives";

export function Friends({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<
    "all" | "online" | "pending" | "blocked" | "add"
  >("all");
  const [handle, setHandle] = useState("");
  const utils = api.useUtils();
  const router = useRouter();
  const list = api.friends.list.useQuery(undefined, { refetchInterval: 5000 });
  const presence = api.activity.list.useQuery({}, { refetchInterval: 10000 });
  const refresh = () => {
    void utils.friends.invalidate();
    void utils.users.bootstrap.invalidate();
  };
  const request = api.friends.request.useMutation({
    onSuccess: () => {
      refresh();
      setTab("pending");
      setHandle("");
    },
  });
  const respond = api.friends.respond.useMutation({ onSuccess: refresh });
  const remove = api.friends.remove.useMutation({ onSuccess: refresh });
  const block = api.friends.block.useMutation({ onSuccess: refresh });
  const open = api.dm.open.useMutation({
    onSuccess: async (d) => {
      await utils.users.bootstrap.invalidate();
      await router.push(`/channels/@me/${d.id}`);
    },
  });
  const rows =
    list.data?.friends.filter((f) =>
      tab === "pending"
        ? f.status === "pending"
        : f.status === "accepted" &&
          (tab !== "online" ||
            presence.data?.some(
              (p) => p.userId === f.user.id && p.status !== "offline",
            )),
    ) ?? [];
  return (
    <section className="friends-pane">
      <nav className="friend-tabs" aria-label="Friends filters">
        {(["all", "online", "pending", "blocked", "add"] as const).map((t) => (
          <button
            key={t}
            className={`${t === tab ? "active" : ""} ${t === "add" ? "add-friend" : ""}`}
            aria-pressed={t === tab}
            onClick={() => setTab(t)}
          >
            {t === "add"
              ? "Add friend"
              : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "pending" &&
            list.data?.friends.some((f) => f.status === "pending")
              ? " •"
              : ""}
          </button>
        ))}
      </nav>
      <ErrorNotice
        error={
          list.error ??
          request.error ??
          respond.error ??
          remove.error ??
          block.error ??
          open.error
        }
      />
      {tab === "add" ? (
        <form
          className="add-friend-form"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ handle });
          }}
        >
          <h2>Find your people</h2>
          <p>
            You can add friends with their exact handle. Yours is{" "}
            <strong>@{profile.handle}</strong>.
          </p>
          <label>
            Friend’s handle
            <input
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]{3,32}"
              placeholder="their_handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
            />
          </label>
          <button className="primary" disabled={request.isPending}>
            Send friend request
          </button>
        </form>
      ) : list.isPending ? (
        <p className="padded" role="status">
          Loading friends…
        </p>
      ) : list.error ? null : tab === "blocked" ? (
        <div className="friend-list">
          {!list.data?.blocked.length ? (
            <Empty title="No blocked people">
              <p>People you block will appear here.</p>
            </Empty>
          ) : (
            list.data.blocked.map((u) => (
              <div key={u.id} className="friend-row">
                <Avatar name={u.displayName} />
                <span className="friend-info">
                  <strong>{u.displayName}</strong>
                  <small>@{u.handle}</small>
                </span>
                <button
                  disabled={block.isPending}
                  onClick={() => block.mutate({ userId: u.id, blocked: false })}
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      ) : !rows.length ? (
        <Empty
          title={
            tab === "pending"
              ? "All caught up"
              : tab === "online"
                ? "A quiet moment"
                : "Good conversations start with a hello"
          }
        >
          <p>
            {tab === "pending"
              ? "Your incoming and outgoing friend requests will appear here."
              : "Add a friend, start a conversation, make this place yours."}
          </p>
          <button className="primary" onClick={() => setTab("add")}>
            Add a friend
          </button>
        </Empty>
      ) : (
        <div className="friend-list">
          <div className="section-label">
            {tab === "pending" ? "Pending" : "Friends"} · {rows.length}
          </div>
          {rows.map((f) => (
            <div className="friend-row" key={f.user.id}>
              <Avatar name={f.user.displayName} />
              <span className="friend-info">
                <strong>{f.user.displayName}</strong>
                <small>
                  @{f.user.handle} ·{" "}
                  {f.status === "pending"
                    ? f.incoming
                      ? "Incoming request"
                      : "Outgoing request"
                    : (presence.data?.find((p) => p.userId === f.user.id)
                        ?.status ?? "offline")}
                </small>
              </span>
              {f.status === "accepted" ? (
                <>
                  <button
                    disabled={open.isPending}
                    onClick={() => open.mutate({ userId: f.user.id })}
                  >
                    Message
                  </button>
                  <details className="row-menu">
                    <summary aria-label={`Actions for ${f.user.displayName}`}>
                      •••
                    </summary>
                    <div>
                      <button
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ userId: f.user.id })}
                      >
                        Remove friend
                      </button>
                      <button
                        className="danger"
                        disabled={block.isPending}
                        onClick={() =>
                          block.mutate({ userId: f.user.id, blocked: true })
                        }
                      >
                        Block
                      </button>
                    </div>
                  </details>
                </>
              ) : f.incoming ? (
                <>
                  <button
                    disabled={respond.isPending}
                    onClick={() =>
                      respond.mutate({ userId: f.user.id, action: "accept" })
                    }
                  >
                    Accept
                  </button>
                  <button
                    disabled={respond.isPending}
                    onClick={() =>
                      respond.mutate({ userId: f.user.id, action: "decline" })
                    }
                  >
                    Decline
                  </button>
                </>
              ) : (
                <button
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ userId: f.user.id })}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
