import { useState } from "react";
import { useRouter } from "next/router";
import { api, type RouterOutputs } from "~/utils/api";
import type { Profile } from "./AuthGate";
import { ErrorNotice, Modal } from "./Primitives";
import { P } from "~/server/chat/permissions";

type Detail = RouterOutputs["servers"]["get"];
const permissionNames = Object.entries(P).map(([key, value]) => ({
  value,
  label: key.toLowerCase().split("_").join(" "),
}));
function PermissionPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="permission-grid">
      {permissionNames.map((p) => (
        <label key={p.value} className="check-label">
          <input
            type="checkbox"
            disabled={disabled}
            checked={!!(value & p.value)}
            onChange={(e) =>
              onChange(e.target.checked ? value | p.value : value & ~p.value)
            }
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}
export function ServerSettings({
  data: initialData,
  profile,
  onClose,
}: {
  data: Detail;
  profile: Profile;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [name, setName] = useState(initialData.server.name);
  const [confirmation, setConfirmation] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();
  const utils = api.useUtils();
  const serverId = initialData.server.id;
  const detail = api.servers.get.useQuery({ serverId }, { initialData });
  const data = detail.data ?? initialData;
  const can = (bit: number) => !!(data.permissions & bit);
  const owner = data.server.ownerId === profile.id;
  const refresh = () => {
    setNotice("Saved.");
    void utils.servers.invalidate();
    void utils.users.bootstrap.invalidate();
  };
  const exit = () => {
    onClose();
    void router.push("/channels/@me");
    void utils.users.bootstrap.invalidate();
  };
  const update = api.servers.update.useMutation({ onSuccess: refresh });
  const transfer = api.servers.transfer.useMutation({ onSuccess: refresh });
  const leave = api.servers.leave.useMutation({ onSuccess: exit });
  const remove = api.servers.delete.useMutation({ onSuccess: exit });
  const moderation = api.moderation.memberAction.useMutation({
    onSuccess: refresh,
  });
  const assignment = api.moderation.roleAssign.useMutation({
    onSuccess: refresh,
  });
  const block = api.friends.block.useMutation({ onSuccess: refresh });
  const invites = api.invites.list.useQuery(
    { serverId },
    { enabled: tab === "invites" && can(P.MANAGE_SERVER) },
  );
  const revoke = api.invites.revoke.useMutation({
    onSuccess: () => void invites.refetch(),
  });
  const bans = api.moderation.bans.useQuery(
    { serverId },
    { enabled: tab === "bans" && can(P.BAN_MEMBERS) },
  );
  const unban = api.moderation.unban.useMutation({
    onSuccess: () => void bans.refetch(),
  });
  const [roleId, setRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleBits, setRoleBits] = useState(0);
  const [rolePosition, setRolePosition] = useState(1);
  const saveRole = api.moderation.roleSave.useMutation({ onSuccess: refresh });
  const deleteRole = api.moderation.roleDelete.useMutation({
    onSuccess: () => {
      setRoleId("");
      refresh();
    },
  });
  const [overwriteChannel, setOverwriteChannel] = useState(
    data.channels[0]?.id ?? "",
  );
  const [overwriteTarget, setOverwriteTarget] = useState("");
  const [allow, setAllow] = useState(0);
  const [deny, setDeny] = useState(0);
  const overwrite = api.moderation.overwrite.useMutation({
    onSuccess: refresh,
  });
  const errors =
    detail.error ??
    update.error ??
    transfer.error ??
    leave.error ??
    remove.error ??
    moderation.error ??
    assignment.error ??
    block.error ??
    revoke.error ??
    invites.error ??
    bans.error ??
    unban.error ??
    saveRole.error ??
    deleteRole.error ??
    overwrite.error;
  if (detail.error)
    return (
      <Modal title="Server unavailable" onClose={onClose}>
        <ErrorNotice error={detail.error} />
      </Modal>
    );
  const tabs = [
    "overview",
    ...(can(P.MANAGE_CHANNELS) ? ["channels"] : []),
    ...(can(P.MANAGE_ROLES) ? ["roles", "permissions"] : []),
    "members",
    ...(can(P.MANAGE_SERVER) ? ["invites"] : []),
    ...(can(P.BAN_MEMBERS) ? ["bans"] : []),
  ];
  return (
    <Modal title={`${data.server.name} settings`} onClose={onClose}>
      <nav className="settings-tabs" aria-label="Server settings sections">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setNotice("");
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <ErrorNotice error={errors} />
      <p role="status" className="saved-notice">
        {notice}
      </p>
      {tab === "overview" && (
        <>
          {can(P.MANAGE_SERVER) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({ serverId, name });
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
                />
              </label>
              <button className="primary" disabled={update.isPending}>
                Save name
              </button>
            </form>
          )}
          {owner ? (
            <>
              <hr />
              <h3>Transfer ownership</h3>
              <p>
                The new owner will have full control. You can leave after
                transferring.
              </p>
              <label>
                New owner
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Select a member</option>
                  {data.members
                    .filter((m) => m.id !== profile.id)
                    .map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!target || transfer.isPending}
                onClick={() => transfer.mutate({ serverId, userId: target })}
              >
                Transfer ownership
              </button>
              <hr />
              <h3>Delete server</h3>
              <p>
                Enter <strong>{data.server.name}</strong> to confirm. Everyone
                will lose access.
              </p>
              <label>
                Confirm server name
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                className="danger-button"
                disabled={confirmation !== data.server.name || remove.isPending}
                onClick={() => remove.mutate({ serverId, confirmation })}
              >
                Delete server
              </button>
            </>
          ) : (
            <>
              <hr />
              <h3>Leave this community</h3>
              <p>You’ll need a new invitation to join again.</p>
              <button
                className="danger-button"
                disabled={leave.isPending}
                onClick={() => leave.mutate({ serverId })}
              >
                Leave server
              </button>
            </>
          )}
        </>
      )}
      {tab === "channels" && <ChannelEditor data={data} />}
      {tab === "roles" && (
        <>
          <h3>Server roles</h3>
          <label>
            Role
            <select
              value={roleId}
              onChange={(e) => {
                const r = data.roles.find((r) => r.id === e.target.value);
                setRoleId(e.target.value);
                setRoleName(r?.name ?? "");
                setRoleBits(r?.permissions ?? 0);
                setRolePosition(r?.position ?? 1);
              }}
            >
              <option value="">Create a role</option>
              {[...data.roles]
                .sort((a, b) => b.position - a.position)
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name} (position {r.position})
                  </option>
                ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveRole.mutate({
                serverId,
                roleId: roleId || undefined,
                name: roleName,
                permissions: roleBits,
                position: rolePosition,
              });
            }}
          >
            <label>
              Role name
              <input
                required
                value={roleName}
                maxLength={100}
                onChange={(e) => setRoleName(e.target.value)}
              />
            </label>
            <label>
              Hierarchy position
              <input
                type="number"
                min={
                  data.roles.find((r) => r.id === roleId)?.isEveryone ? 0 : 1
                }
                max={1000}
                value={rolePosition}
                onChange={(e) => setRolePosition(Number(e.target.value))}
              />
            </label>
            <p>
              Higher positions can manage lower positions. Everyone stays at
              position zero.
            </p>
            <PermissionPicker value={roleBits} onChange={setRoleBits} />
            <button className="primary" disabled={saveRole.isPending}>
              Save role
            </button>
            {roleId && !data.roles.find((r) => r.id === roleId)?.isEveryone && (
              <button
                type="button"
                className="danger"
                disabled={deleteRole.isPending}
                onClick={() => deleteRole.mutate({ serverId, roleId })}
              >
                Delete role
              </button>
            )}
          </form>
        </>
      )}
      {tab === "permissions" && (
        <>
          <h3>Channel permissions</h3>
          <p>
            Choose a target to replace its channel permissions. Unchecked
            permissions inherit from roles.
          </p>
          <label>
            Channel
            <select
              value={overwriteChannel}
              onChange={(e) => {
                setOverwriteChannel(e.target.value);
                setOverwriteTarget("");
                setAllow(0);
                setDeny(0);
              }}
            >
              {data.channels.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role or member
            <select
              value={overwriteTarget}
              onChange={(e) => {
                const value = e.target.value;
                setOverwriteTarget(value);
                const [kind, id] = value.split(":");
                const current = data.overwrites.find(
                  (o) =>
                    o.channelId === overwriteChannel &&
                    (kind === "role" ? o.roleId === id : o.userId === id),
                );
                setAllow(current?.allow ?? 0);
                setDeny(current?.deny ?? 0);
              }}
            >
              <option value="">Select target</option>
              <optgroup label="Roles">
                {data.roles.map((r) => (
                  <option value={`role:${r.id}`} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Members">
                {data.members.map((m) => (
                  <option value={`user:${m.id}`} key={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <h4>Allow</h4>
          <PermissionPicker
            value={allow}
            onChange={(v) => {
              setAllow(v);
              setDeny((d) => d & ~v);
            }}
          />
          <h4>Deny</h4>
          <PermissionPicker
            value={deny}
            onChange={(v) => {
              setDeny(v);
              setAllow((a) => a & ~v);
            }}
          />
          <button
            className="primary"
            disabled={
              !overwriteChannel || !overwriteTarget || overwrite.isPending
            }
            onClick={() => {
              const [kind, id] = overwriteTarget.split(":");
              overwrite.mutate({
                channelId: overwriteChannel,
                roleId: kind === "role" ? id : undefined,
                userId: kind === "user" ? id : undefined,
                allow,
                deny,
              });
            }}
          >
            Save channel permissions
          </button>
        </>
      )}
      {tab === "members" && (
        <>
          <label>
            Moderation reason
            <input
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {data.members.map((m) => (
            <div key={m.id} className="settings-member">
              <strong>
                {m.displayName} <small>@{m.handle}</small>
              </strong>
              {can(P.MANAGE_ROLES) && (
                <div className="role-assignments">
                  {data.roles
                    .filter((r) => !r.isEveryone)
                    .map((r) => (
                      <label className="check-label" key={r.id}>
                        <input
                          type="checkbox"
                          checked={m.roleIds.includes(r.id)}
                          disabled={assignment.isPending}
                          onChange={(e) =>
                            assignment.mutate({
                              serverId,
                              userId: m.id,
                              roleId: r.id,
                              assigned: e.target.checked,
                            })
                          }
                        />
                        {r.name}
                      </label>
                    ))}
                </div>
              )}
              {m.id !== profile.id && (
                <div className="button-row">
                  {can(P.KICK_MEMBERS) && m.id !== data.server.ownerId && (
                    <button
                      className="danger"
                      disabled={moderation.isPending}
                      onClick={() =>
                        moderation.mutate({
                          serverId,
                          userId: m.id,
                          action: "kick",
                          reason,
                        })
                      }
                    >
                      Kick
                    </button>
                  )}
                  {can(P.BAN_MEMBERS) && m.id !== data.server.ownerId && (
                    <button
                      className="danger"
                      disabled={moderation.isPending}
                      onClick={() =>
                        moderation.mutate({
                          serverId,
                          userId: m.id,
                          action: "ban",
                          reason,
                        })
                      }
                    >
                      Ban
                    </button>
                  )}
                  <button
                    disabled={block.isPending}
                    onClick={() =>
                      block.mutate({ userId: m.id, blocked: true })
                    }
                  >
                    Block
                  </button>
                  <button
                    disabled={block.isPending}
                    onClick={() =>
                      block.mutate({ userId: m.id, blocked: false })
                    }
                  >
                    Unblock
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {tab === "invites" && (
        <>
          {invites.isPending && <p role="status">Loading invites…</p>}
          {invites.data?.length === 0 && <p>No invitations yet.</p>}
          {invites.data?.map((i) => (
            <div className="settings-member" key={i.id}>
              <span>
                {i.uses} / {i.maxUses ?? "unlimited"} uses ·{" "}
                {i.revokedAt
                  ? "Revoked"
                  : i.expiresAt && i.expiresAt < new Date()
                    ? "Expired"
                    : "Active"}
              </span>
              {!i.revokedAt && (
                <button
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ inviteId: i.id })}
                >
                  Revoke invite
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {tab === "bans" && (
        <>
          {bans.isPending && <p role="status">Loading bans…</p>}
          {bans.data?.length === 0 && <p>No banned members.</p>}
          {bans.data?.map((b) => (
            <div className="settings-member" key={b.userId}>
              <strong>{b.displayName}</strong>
              <p>{b.reason}</p>
              <button
                disabled={unban.isPending}
                onClick={() => unban.mutate({ serverId, userId: b.userId })}
              >
                Revoke ban
              </button>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
function ChannelEditor({ data }: { data: Detail }) {
  const [selected, setSelected] = useState(data.channels[0]?.id ?? "");
  const channel = data.channels.find((c) => c.id === selected);
  return (
    <>
      <h3>Channels and categories</h3>
      <label>
        Channel
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Select channel</option>
          {data.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {channel && (
        <ChannelForm key={channel.id} channel={channel} data={data} />
      )}
      <CategoryForm data={data} />
    </>
  );
}
function ChannelForm({
  channel,
  data,
}: {
  channel: Detail["channels"][number];
  data: Detail;
}) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [position, setPosition] = useState(channel.position);
  const [categoryId, setCategoryId] = useState(channel.categoryId ?? "");
  const [confirm, setConfirm] = useState(false);
  const utils = api.useUtils();
  const update = api.channels.update.useMutation({
    onSuccess: () => void utils.servers.invalidate(),
  });
  const remove = api.channels.delete.useMutation({
    onSuccess: () => void utils.servers.invalidate(),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({
          channelId: channel.id,
          name,
          topic,
          position,
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
        />
      </label>
      <label>
        Topic
        <textarea
          maxLength={1024}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
      <label>
        Position
        <input
          type="number"
          min={0}
          max={100}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <label>
        Category
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Uncategorized</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={update.error ?? remove.error} />
      <button className="primary" disabled={update.isPending}>
        Save channel
      </button>
      <label className="check-label">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        I want to delete this channel and remove access to its history.
      </label>
      <button
        type="button"
        className="danger"
        disabled={!confirm || remove.isPending}
        onClick={() => remove.mutate({ channelId: channel.id })}
      >
        Delete channel
      </button>
    </form>
  );
}
function CategoryForm({ data }: { data: Detail }) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState(0);
  const utils = api.useUtils();
  const save = api.channels.categorySave.useMutation({
    onSuccess: () => void utils.servers.invalidate(),
  });
  const remove = api.channels.categoryDelete.useMutation({
    onSuccess: () => {
      setCategoryId("");
      setName("");
      void utils.servers.invalidate();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          serverId: data.server.id,
          categoryId: categoryId || undefined,
          name,
          position,
        });
      }}
    >
      <hr />
      <h3>Category</h3>
      <label>
        Category
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            const c = data.categories.find((c) => c.id === e.target.value);
            setName(c?.name ?? "");
            setPosition(c?.position ?? 0);
          }}
        >
          <option value="">Create a category</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category name
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Position
        <input
          type="number"
          min={0}
          max={100}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <ErrorNotice error={save.error ?? remove.error} />
      <button disabled={save.isPending}>Save category</button>
      {categoryId && (
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate({ serverId: data.server.id, categoryId })
          }
        >
          Remove category (keep channels)
        </button>
      )}
    </form>
  );
}
