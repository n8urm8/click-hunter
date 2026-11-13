import { SignIn, useAuth } from "@clerk/react";
import { useEffect, useRef } from "react";
import { Fireflies } from "~/components/ui/fireflies";

/**
 * Full-page sign-in and sign-up, shown to anyone not signed in. Clerk owns the
 * forms, email verification and password reset. Every character belongs to an
 * account, so there is no anonymous play.
 */
export function SignInScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const sawSignedOut = useRef(false);

  // A session that starts while this screen is open leaves the cached "no
  // character" answer from the signed-out state in place. Reloading starts the
  // account's session with fresh data. A user who was already signed in when
  // the page loaded does not reload, so a token problem cannot loop.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      sawSignedOut.current = true;
      return;
    }
    if (sawSignedOut.current) {
      window.location.reload();
    }
  }, [isLoaded, isSignedIn]);

  return (
    <div className="min-h-screen flex items-center justify-center forest-bg relative p-4">
      <Fireflies count={30} />
      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-heading text-gold glow-gold">Gloamwake</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in or create an account to play. Your character is saved to your account.
          </p>
        </div>
        <SignIn routing="hash" />
      </div>
    </div>
  );
}
