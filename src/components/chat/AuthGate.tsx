import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type RouterOutputs } from "~/utils/api";
import { ErrorNotice } from "./Primitives";
export type Profile = NonNullable<RouterOutputs["users"]["me"]>;
export function safeReturnPath(value: unknown) {
  return typeof value === "string" &&
    /^\/(?:channels|invite|onboarding|settings)(?:\/|\?|$)/.test(value) &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/channels/@me";
}
function ProfileGate({
  children,
}: {
  children: (profile: Profile) => ReactNode;
}) {
  const me = api.users.me.useQuery(undefined, { retry: false });
  if (me.isPending)
    return (
      <div className="auth-screen" role="status">
        Opening your workspace…
      </div>
    );
  if (me.error)
    return (
      <div className="auth-screen">
        <ErrorNotice error={me.error} />
        <button onClick={() => void me.refetch()}>Try again</button>
        <UserButton />
      </div>
    );
  if (!me.data)
    return (
      <div className="auth-screen">
        <ProfileForm onSaved={() => void me.refetch()} />
        <UserButton />
      </div>
    );
  return children(me.data);
}
export function AuthGate({
  children,
}: {
  children: (profile: Profile) => ReactNode;
}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const queryClient = useQueryClient();
  const [cacheOwner, setCacheOwner] = useState<string | null>(null);
  const userId = user?.id ?? "signed-out";
  // Clear private query data before mounting a different Clerk identity.
  useEffect(() => {
    queryClient.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCacheOwner(userId);
  }, [userId, queryClient]);
  if (!isLoaded || cacheOwner !== userId)
    return (
      <div className="auth-screen" role="status">
        Loading…
      </div>
    );
  if (!isSignedIn) {
    const destination = safeReturnPath(
      typeof window === "undefined"
        ? null
        : window.location.pathname + window.location.search,
    );
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <span className="brand-mark">gather</span>
          <h1>
            Your people.
            <br />
            Your place to talk.
          </h1>
          <p>
            A home for your communities, conversations and whatever comes next.
          </p>
          <SignInButton mode="modal" forceRedirectUrl={destination}>
            <button className="primary">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal" forceRedirectUrl={destination}>
            <button>Create an account</button>
          </SignUpButton>
        </div>
      </main>
    );
  }
  return <ProfileGate>{children}</ProfileGate>;
}
export function ProfileForm({
  profile,
  onSaved,
  onDirtyChange,
}: {
  profile?: Profile;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [status, setStatus] = useState<Profile["status"]>(
    profile?.status ?? "online",
  );
  const [theme, setTheme] = useState<Profile["theme"]>(
    profile?.theme ?? "dark",
  );
  const save = api.users.save.useMutation({
    onSuccess: () => {
      onDirtyChange?.(false);
      onSaved();
    },
  });
  return (
    <form
      className="profile-form"
      onChange={() => onDirtyChange?.(true)}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ handle, displayName, bio, status, theme });
      }}
    >
      <h1>{profile ? "Your profile" : "Make yourself at home"}</h1>
      <p>Choose how you’ll appear to your friends and communities.</p>
      <label>
        Display name
        <input
          required
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="nickname"
        />
      </label>
      <label>
        Unique handle
        <input
          required
          value={handle}
          minLength={3}
          maxLength={32}
          pattern="[a-z0-9_]{3,32}"
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          autoComplete="username"
        />
        <span className="muted">
          3–32 lowercase letters, digits or underscores.
        </span>
      </label>
      <label>
        About me
        <textarea
          maxLength={190}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Profile["status"])}
          >
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="dnd">Do not disturb</option>
            <option value="invisible">Invisible</option>
          </select>
        </label>
        <label>
          Appearance
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Profile["theme"])}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>
      </div>
      <ErrorNotice error={save.error} />
      <button className="primary" disabled={save.isPending}>
        {save.isPending
          ? "Saving…"
          : profile
            ? "Save changes"
            : "Continue to Gather"}
      </button>
    </form>
  );
}
