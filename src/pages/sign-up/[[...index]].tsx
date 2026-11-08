import { SignUp } from "@clerk/nextjs";
export default function SignUpPage() {
  return (
    <main className="auth-screen">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/channels/@me"
      />
    </main>
  );
}
