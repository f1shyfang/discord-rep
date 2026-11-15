import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate, ProfileForm } from "~/components/chat/AuthGate";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
import { useClerk } from "@clerk/nextjs";
import Head from "next/head";
export default function Settings() {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const utils = api.useUtils();
  const clerk = useClerk();
  return (
    <AuthGate>
      {(profile) => (
        <main className={`settings-page theme-${profile.theme}`}>
          <Head>
            <title>Account settings — Gather</title>
          </Head>
          <Link
            href="/channels/@me"
            onClick={(e) => {
              if (dirty && !window.confirm("Discard unsaved profile changes?"))
                e.preventDefault();
            }}
          >
            ← Back to conversations
          </Link>
          <ProfileForm
            profile={profile}
            onDirtyChange={setDirty}
            onSaved={() => {
              void utils.users.invalidate();
              void router.push("/channels/@me");
            }}
          />
          <section aria-labelledby="account-deletion-heading">
            <h2 id="account-deletion-heading">Delete your account</h2>
            <p>
              Account deletion is permanent. Your profile details, friendships,
              reactions and notification settings are erased after the verified
              deletion event is processed. Shared messages remain under “Deleted
              user,” including any personal information you wrote in them.
              Delete any messages you want removed before deleting your account.
            </p>
            <p>
              Your communities pass to their highest-ranked active
              administrator, with join date breaking ties. If none is eligible,
              the community becomes a read-only archive for existing members.
              You can choose a new owner in Server settings before deleting your
              account.
            </p>
            <p>
              A minimal account identifier is retained to prevent access from
              old sessions or delayed events. Backups and moderation audit
              records follow their separate retention periods. Archived
              communities are not automatically purged after seven days.
            </p>
            <button
              type="button"
              className="danger"
              onClick={() => clerk.openUserProfile()}
            >
              Open account deletion controls
            </button>
            <p>
              In account settings, open Security → Delete account. Clerk will
              ask you to confirm.
            </p>
          </section>
        </main>
      )}
    </AuthGate>
  );
}
