import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div>
        <div className="text-[11px] tracking-[0.4em] text-accent uppercase mb-3 text-center">
          Phresh Mastery
        </div>
        <SignUp
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
          forceRedirectUrl="/dashboard"
        />
      </div>
    </main>
  );
}
