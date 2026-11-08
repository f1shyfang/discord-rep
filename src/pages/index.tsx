import {
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";
import { api } from "~/utils/api";

export default function Home() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { data: secretMessage } = api.post.getSecretMessage.useQuery(
    undefined,
    { enabled: isLoaded && !!isSignedIn },
  );
  return (
    <main className="flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl">Lyra fullstack starter</h1>
      <Show when="signed-in">
        <p>
          Logged in as{" "}
          {user?.fullName ?? user?.primaryEmailAddress?.emailAddress}
        </p>
        <UserButton />
        {secretMessage && <p>{secretMessage}</p>}
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal" />
        <SignUpButton mode="modal" />
      </Show>
      <Link href="/jobs">Jobs site</Link>
    </main>
  );
}
