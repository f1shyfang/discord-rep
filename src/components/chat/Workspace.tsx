import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { api } from "~/utils/api";
import type { Profile } from "./AuthGate";
import { Avatar, Empty, ErrorNotice, Modal } from "./Primitives";
import { Friends } from "./Friends";
import { Conversation } from "./Conversation";
import { ServerSettings } from "./ServerSettings";
import { P } from "~/server/chat/permissions";

export function Workspace({ profile }: { profile: Profile }) {
  const router = useRouter();
  const path = Array.isArray(router.query.path) ? router.query.path : ["@me"];
  const serverId = path[0] !== "@me" ? path[0] : undefined;
  const channelId = path[1];
  const home = !serverId;
  const utils = api.useUtils();
  const bootstrap = api.users.bootstrap.useQuery(undefined, {
    refetchInterval: 5000,
    retry: false,
  });
  const detail = api.servers.get.useQuery(
    { serverId: serverId ?? "00000000-0000-4000-8000-000000000000" },
    { enabled: !!serverId, refetchInterval: 5000, retry: false },
  );
  const heartbeat = api.activity.heartbeat.useMutation();
  const [dialog, setDialog] = useState<
    "create" | "join" | "invite" | "channel" | "settings" | "switcher" | null
  >(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "f") {
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Search this conversation"]',
        );
        if (input) {
          event.preventDefault();
          input.focus();
        }
      } else if (
        event.key.toLowerCase() === "k" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement).tagName,
        )
      ) {
        event.preventDefault();
        setDialog("switcher");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const [navOpen, setNavOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const presence = api.activity.list.useQuery(
    { serverId },
    { refetchInterval: 10000 },
  );
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") heartbeat.mutate();
    };
    beat();
    const interval = setInterval(beat, 25000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
    // Mutation objects are intentionally not interval dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const channel = detail.data?.channels.find((c) => c.id === channelId);
  const dm = bootstrap.data?.dms.find((d) => d.id === channelId);
  const conversationId = home ? dm?.id : channel?.conversationId;
  const conversationIds = home
    ? (bootstrap.data?.dms.map((d) => d.id) ?? [])
    : (detail.data?.channels.flatMap((c) =>
        c.conversationId ? [c.conversationId] : [],
      ) ?? []);
  const reads = api.reads.summary.useQuery(
    { conversationIds },
    { enabled: conversationIds.length > 0, refetchInterval: 5000 },
  );
  const navigate = () => {
    setNavOpen(false);
    setDialog(null);
  };
  if (bootstrap.error)
    return (
      <main className="auth-screen">
        <ErrorNotice error={bootstrap.error} />
        <button onClick={() => void bootstrap.refetch()}>Reconnect</button>
        <UserButton />
      </main>
    );
  const detailReady = !serverId || (detail.data && !detail.error);
  return (
    <div
      className={`chat-app theme-${profile.theme} ${navOpen ? "nav-open" : ""} ${membersOpen ? "members-open" : ""}`}
    >
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      <nav className="server-rail" aria-label="Servers">
        <Link
          className={`server-icon home-icon ${home ? "selected" : ""}`}
          href="/channels/@me"
          title="Home"
          aria-label="Home"
          aria-current={home ? "page" : undefined}
          onClick={() => {
            setNavOpen(true);
            setDialog(null);
          }}
        >
          g.
        </Link>
        <span className="rail-divider" />
        {bootstrap.data?.servers.map((server) => (
          <Link
            key={server.id}
            className={`server-icon ${server.id === serverId ? "selected" : ""}`}
            href={`/channels/${server.id}`}
            aria-label={server.name}
            title={server.name}
            aria-current={server.id === serverId ? "page" : undefined}
            onClick={() => {
              setNavOpen(true);
              setDialog(null);
            }}
          >
            {server.name
              .split(/\s+/)
              .map((s) => s[0])
              .join("")
              .slice(0, 3)}
          </Link>
        ))}
        <button
          className="server-icon rail-action"
          onClick={() => setDialog("create")}
          title="Create a server"
          aria-label="Create a server"
        >
          +
        </button>
        <button
          className="server-icon rail-action"
          onClick={() => setDialog("join")}
          title="Join a server"
          aria-label="Join a server"
        >
          ↗
        </button>
        <span className="rail-brand" aria-hidden="true">
          gather
        </span>
      </nav>
      <aside
        className="channel-sidebar"
        aria-label={home ? "Direct messages" : "Channels"}
      >
        <header className="sidebar-header">
          <strong>
            {home
              ? "Your conversations"
              : (detail.data?.server.name ?? "Community")}
          </strong>
          <button
            className="mobile-only"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            ×
          </button>
        </header>
        <nav className="channel-navigation" aria-label="Conversations">
          {home ? (
            <>
              <Link
                href="/channels/@me"
                className={`channel-link ${!channelId ? "active" : ""}`}
                onClick={navigate}
              >
                <span aria-hidden="true">♧</span> Friends
              </Link>
              <div className="section-label">Direct messages</div>
              {!bootstrap.data?.dms.length && (
                <p className="sidebar-hint">
                  Add a friend to start a conversation.
                </p>
              )}
              {bootstrap.data?.dms.map((d) => (
                <Link
                  key={d.id}
                  href={`/channels/@me/${d.id}`}
                  className={`channel-link dm-link ${d.id === channelId ? "active" : ""}`}
                  onClick={navigate}
                >
                  <Avatar name={d.user.displayName} small />
                  <span>{d.user.displayName}</span>
                  <Unread
                    read={reads.data?.find((r) => r.conversationId === d.id)}
                  />
                </Link>
              ))}
            </>
          ) : (
            <>
              {detail.error ? (
                <ErrorNotice error={detail.error} />
              ) : detail.isPending ? (
                <p className="sidebar-hint" role="status">
                  Loading channels…
                </p>
              ) : (
                <>
                  {detail.data &&
                    (detail.data.permissions & P.CREATE_INVITE) !== 0 && (
                      <button
                        className="invite-button"
                        onClick={() => setDialog("invite")}
                      >
                        Invite people <span aria-hidden="true">+</span>
                      </button>
                    )}
                  {[null, ...(detail.data?.categories ?? [])].map(
                    (category) => {
                      const rows =
                        detail.data?.channels.filter(
                          (c) => c.categoryId === (category?.id ?? null),
                        ) ?? [];
                      if (!rows.length) return null;
                      return (
                        <div key={category?.id ?? "uncategorized"}>
                          <div className="section-label">
                            {category?.name ?? "Channels"}
                          </div>
                          {rows.map((c) => (
                            <Link
                              key={c.id}
                              href={`/channels/${serverId}/${c.id}`}
                              className={`channel-link ${c.id === channelId ? "active" : ""}`}
                              onClick={navigate}
                              aria-current={
                                c.id === channelId ? "page" : undefined
                              }
                            >
                              <span className="channel-hash" aria-hidden="true">
                                {c.kind === "text" ? "#" : "◖"}
                              </span>
                              <span>{c.name}</span>
                              <Unread
                                read={reads.data?.find(
                                  (r) => r.conversationId === c.conversationId,
                                )}
                              />
                            </Link>
                          ))}
                        </div>
                      );
                    },
                  )}
                  {detail.data &&
                    (detail.data.permissions & P.MANAGE_CHANNELS) !== 0 && (
                      <button
                        className="subtle-button"
                        onClick={() => setDialog("channel")}
                      >
                        + Create channel
                      </button>
                    )}
                  {detail.data && (
                    <button
                      className="subtle-button"
                      onClick={() => setDialog("settings")}
                    >
                      Server settings
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </nav>
        <footer className="user-panel">
          <UserButton />
          <span>
            <strong>{profile.displayName}</strong>
            <small>
              {profile.status === "dnd" ? "Do not disturb" : profile.status}
            </small>
          </span>
          <Link
            href="/settings/profile"
            aria-label="User settings"
            title="User settings"
          >
            ⚙
          </Link>
        </footer>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <main className="conversation-pane" id="conversation">
        <header className="conversation-header">
          <button
            className="mobile-only"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            ☰
          </button>
          <span className="header-hash" aria-hidden="true">
            {home ? "@" : "#"}
          </span>
          <h1>
            {home
              ? (dm?.user.displayName ?? "Friends")
              : (channel?.name ?? detail.data?.server.name ?? "Community")}
          </h1>
          {channel?.topic && <p className="channel-topic">{channel.topic}</p>}
          <span className="header-spacer" />
          {!home && (
            <button
              aria-label="Toggle member list"
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((v) => !v)}
            >
              Members
            </button>
          )}
        </header>
        {!detailReady ? (
          <Empty
            title={
              detail.error ? "This server is unavailable" : "Opening community…"
            }
          >
            <ErrorNotice error={detail.error} />
            <Link href="/channels/@me">Return to Home</Link>
          </Empty>
        ) : conversationId ? (
          <Conversation
            key={conversationId}
            conversationId={conversationId}
            name={home ? dm!.user.displayName : channel!.name}
            profile={profile}
            people={home ? (dm ? [dm.user] : []) : (detail.data?.members ?? [])}
            readSeq={
              reads.data?.find((r) => r.conversationId === conversationId)
                ?.lastReadSeq ?? "0"
            }
          />
        ) : home && !channelId ? (
          <Friends profile={profile} />
        ) : channel?.kind === "voice" ? (
          <Empty title={channel.name}>
            <p>
              Voice is planned for a later release. Text channels are ready to
              use.
            </p>
          </Empty>
        ) : (
          <Empty
            title={
              channelId
                ? "Conversation unavailable"
                : "Welcome to your community"
            }
          >
            <p>
              {channelId
                ? "Choose another conversation from the sidebar."
                : "Choose a channel to start talking."}
            </p>
            <button className="mobile-only" onClick={() => setNavOpen(true)}>
              Browse channels
            </button>
          </Empty>
        )}
      </main>
      {!home && membersOpen && (
        <aside className="member-sidebar" aria-label="Members">
          <div className="section-label">
            Members · {detail.error ? 0 : (detail.data?.members.length ?? 0)}
          </div>
          {!detail.error &&
            detail.data?.members.map((m) => {
              const status =
                presence.data?.find((p) => p.userId === m.id)?.status ??
                "offline";
              return (
                <div className="member-row" key={m.id}>
                  <Avatar name={m.displayName} small />
                  <span>
                    <strong>
                      {m.displayName}
                      {m.id === detail.data.server.ownerId ? " ♛" : ""}
                    </strong>
                    <small className={`presence status-${status}`}>
                      {status === "dnd" ? "Do not disturb" : status}
                    </small>
                  </span>
                </div>
              );
            })}
        </aside>
      )}
      {dialog === "switcher" && (
        <Modal title="Jump to a conversation" onClose={() => setDialog(null)}>
          <QuickSwitcher
            destinations={[
              { label: "Friends", href: "/channels/@me" },
              ...(bootstrap.data?.servers.map((s) => ({
                label: s.name,
                href: `/channels/${s.id}`,
              })) ?? []),
              ...(detail.error
                ? []
                : (detail.data?.channels.map((c) => ({
                    label: `# ${c.name}`,
                    href: `/channels/${serverId}/${c.id}`,
                  })) ?? [])),
              ...(bootstrap.data?.dms.map((d) => ({
                label: `@ ${d.user.displayName}`,
                href: `/channels/@me/${d.id}`,
              })) ?? []),
            ]}
            onNavigate={navigate}
          />
        </Modal>
      )}
      {dialog === "create" && <CreateServer onClose={() => setDialog(null)} />}
      {dialog === "join" && <JoinServer onClose={() => setDialog(null)} />}
      {dialog === "invite" && serverId && (
        <InvitePeople serverId={serverId} onClose={() => setDialog(null)} />
      )}
      {dialog === "channel" && detail.data && (
        <CreateChannel
          serverId={detail.data.server.id}
          categories={detail.data.categories}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "settings" && detail.data && (
        <ServerSettings
          data={detail.data}
          profile={profile}
          onClose={() => {
            setDialog(null);
            void utils.servers.invalidate();
            void utils.users.bootstrap.invalidate();
          }}
        />
      )}
    </div>
  );
}
function Unread({
  read,
}: {
  read?: {
    unread: number;
    mentions: number;
    notificationMode?: "all" | "mentions" | "none";
  };
}) {
  if (
    read?.notificationMode === "none" ||
    (read?.notificationMode === "mentions" && !read.mentions)
  )
    return null;
  return read?.unread ? (
    <span
      className={`unread-badge ${read.mentions ? "has-mention" : ""}`}
      aria-label={`${read.unread} unread messages${read.mentions ? `, ${read.mentions} mentions` : ""}`}
    >
      {read.mentions || "•"}
    </span>
  ) : null;
}
function CreateServer({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  const utils = api.useUtils();
  const create = api.servers.create.useMutation({
    onSuccess: async (result) => {
      await utils.users.bootstrap.invalidate();
      onClose();
      await router.push(`/channels/${result.server.id}/${result.channelId}`);
    },
  });
  return (
    <Modal title="Create your server" onClose={onClose}>
      <p>Your server is a place for you and your friends. Give it a name.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, requestId });
        }}
      >
        <label>
          Server name
          <input
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <ErrorNotice error={create.error} />
        <button className="primary" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create server"}
        </button>
      </form>
    </Modal>
  );
}
function JoinServer({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <Modal title="Join a server" onClose={onClose}>
      <p>Enter the invitation link your friend sent you.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const token = invite.trim().split("/").at(-1) ?? "";
          if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            setError("Enter a valid invitation link.");
            return;
          }
          onClose();
          void router.push(`/invite/${token}`);
        }}
      >
        <label>
          Invite link
          <input
            required
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className="error-notice">
            {error}
          </p>
        )}
        <button className="primary">Continue</button>
      </form>
    </Modal>
  );
}
function InvitePeople({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [maxUses, setMaxUses] = useState("0");
  const [copied, setCopied] = useState(false);
  const create = api.invites.create.useMutation();
  const token = create.data?.token;
  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${token}`
      : "";
  return (
    <Modal title="Invite your people" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            serverId,
            requestId,
            expiresInSeconds: 604800,
            maxUses: Number(maxUses) || null,
          });
        }}
      >
        <p>
          Invite links expire after seven days. You can revoke them in server
          settings.
        </p>
        <label>
          Maximum uses
          <select
            value={maxUses}
            onChange={(e) => {
              setMaxUses(e.target.value);
              setRequestId(crypto.randomUUID());
            }}
          >
            <option value="0">Unlimited</option>
            <option value="1">One person</option>
            <option value="10">10 people</option>
            <option value="100">100 people</option>
          </select>
        </label>
        <ErrorNotice error={create.error} />
        {!token && (
          <button className="primary" disabled={create.isPending}>
            Create invite link
          </button>
        )}
      </form>
      {url && (
        <>
          <label>
            Invitation link
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </>
      )}
    </Modal>
  );
}
function CreateChannel({
  serverId,
  categories,
  onClose,
}: {
  serverId: string;
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const utils = api.useUtils();
  const router = useRouter();
  const create = api.channels.create.useMutation({
    onSuccess: async (c) => {
      await utils.servers.invalidate();
      onClose();
      await router.push(`/channels/${serverId}/${c.id}`);
    },
  });
  return (
    <Modal title="Create a text channel" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            serverId,
            name,
            kind: "text",
            categoryId: categoryId || null,
          });
        }}
      >
        <label>
          Channel name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorNotice error={create.error} />
        <button className="primary" disabled={create.isPending}>
          Create channel
        </button>
      </form>
    </Modal>
  );
}

function QuickSwitcher({
  destinations,
  onNavigate,
}: {
  destinations: { label: string; href: string }[];
  onNavigate: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <>
      <label>
        Find a server, channel or friend
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <nav className="switcher-results" aria-label="Search destinations">
        {destinations
          .filter((d) => d.label.toLowerCase().includes(query.toLowerCase()))
          .map((d) => (
            <Link
              className="channel-link"
              key={d.href}
              href={d.href}
              onClick={onNavigate}
            >
              {d.label}
            </Link>
          ))}
      </nav>
    </>
  );
}
