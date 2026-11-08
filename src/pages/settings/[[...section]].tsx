import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate, ProfileForm } from "~/components/chat/AuthGate";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
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
  return (
    <AuthGate>
      {(profile) => (
        <main className={`settings-page theme-${profile.theme}`}>
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
        </main>
      )}
    </AuthGate>
  );
}
