import { useClerk, useUser } from "@clerk/react";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useAccountStatus } from "~/hooks/useAccount";
import { clearGameStorage } from "~/lib/helpers";
import { formatUntil, isActiveUntil } from "~/lib/moderation";

/**
 * Account controls for the profile page: the signed-in email, any mute notice,
 * and sign out. Email changes and password changes happen in Clerk.
 */
export function AccountPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const status = useAccountStatus(isAuthenticated && !isLoading);
  const [actionError, setActionError] = useState<string | null>(null);

  const account = status.data;
  const mutedNow = account !== undefined && isActiveUntil(account.mutedUntil, Date.now());
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  // Reloading starts the next session with fresh data, so the previous account's
  // cached answers are not shown to whoever signs in next.
  const endSession = async () => {
    setActionError(null);
    try {
      await signOut();
      clearGameStorage();
      window.location.assign("/");
    } catch {
      setActionError("Could not sign out. Try again.");
    }
  };

  return (
    <section aria-labelledby="account-heading" className="forest-panel flex flex-col gap-4 p-4">
      <div>
        <h2 id="account-heading" className="font-heading text-lg">
          Account
        </h2>
        {status.isPending && (
          <p className="text-sm text-muted-foreground">Checking your account...</p>
        )}
        {status.isError && !account && (
          <p role="alert" className="text-sm text-blood-light">
            Unable to load your account.
          </p>
        )}
        {email && (
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="text-foreground">{email}</span>.
          </p>
        )}
        {mutedNow && account && (
          <p role="status" className="mt-2 text-sm text-blood-light">
            You are muted {formatUntil(account.mutedUntil)}
            {account.muteReason ? `. Reason: ${account.muteReason}` : "."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void endSession()}
          className="border-blood-light/40 text-blood-light hover:border-blood-light/70 hover:bg-blood/20 hover:text-blood-light"
        >
          Sign out
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-blood-light">
          {actionError}
        </p>
      )}
    </section>
  );
}
