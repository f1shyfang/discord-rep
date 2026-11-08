import { SignIn } from "@clerk/nextjs";
export default function SignInPage() {
  return (
    <main className="auth-screen">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/channels/@me"
      />
    </main>
  );
}
