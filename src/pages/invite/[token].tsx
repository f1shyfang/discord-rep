import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/router";
import Link from "next/link";
import { api } from "~/utils/api";
import { AuthGate } from "~/components/chat/AuthGate";
import { ErrorNotice } from "~/components/chat/Primitives";

function Join({ token }: { token: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const preview = api.invites.preview.useQuery({ token }, { retry: false });
  const accept = api.invites.accept.useMutation({
    onSuccess: async (result) => {
      await utils.users.bootstrap.invalidate();
      await router.push(
        `/channels/${result.server.id}${result.channelId ? `/${result.channelId}` : ""}`,
      );
    },
  });
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <span className="brand-mark">gather</span>
        <p>You’ve been invited to join</p>
        <h1>{preview.data?.serverName ?? "a community"}</h1>
        {preview.isPending && <p role="status">Loading invite…</p>}
        {preview.data && (
          <p>
            {preview.data.memberCount} members · A new conversation starts here.
          </p>
        )}
        <ErrorNotice error={preview.error ?? accept.error} />
        <button
          className="primary"
          disabled={accept.isPending}
          onClick={() => accept.mutate({ token })}
        >
          {accept.isPending ? "Joining…" : "Join server"}
        </button>
        <p>
          <Link href="/channels/@me">Back to Home</Link>
        </p>
      </section>
    </main>
  );
}
function InviteLanding({ token }: { token: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const preview = api.invites.preview.useQuery(
    { token },
    { retry: false, enabled: !isSignedIn },
  );
  if (!isLoaded)
    return (
      <main className="auth-screen" role="status">
        Loading invitation…
      </main>
    );
  if (isSignedIn) return <AuthGate>{() => <Join token={token} />}</AuthGate>;
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <span className="brand-mark">gather</span>
        <p>You’ve been invited to join</p>
        <h1>{preview.data?.serverName ?? "a community"}</h1>
        {preview.data && <p>{preview.data.memberCount} members</p>}
        {preview.isPending && <p role="status">Loading invite…</p>}
        <ErrorNotice error={preview.error} />
        {preview.data && (
          <>
            <p>Sign in to join the conversation.</p>
            <SignInButton mode="modal" forceRedirectUrl={`/invite/${token}`}>
              <button className="primary">Sign in to join</button>
            </SignInButton>
            <SignUpButton mode="modal" forceRedirectUrl={`/invite/${token}`}>
              <button>Create an account</button>
            </SignUpButton>
          </>
        )}
      </section>
    </main>
  );
}
export default function InvitePage() {
  const { query, isReady } = useRouter();
  if (!isReady) return null;
  if (
    typeof query.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(query.token)
  )
    return (
      <main className="auth-screen">
        <h1>Invite unavailable</h1>
        <Link href="/channels/@me">Back to Home</Link>
      </main>
    );
  return <InviteLanding token={query.token} />;
}
