import { useClerk } from "@clerk/react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Fireflies } from "~/components/ui/fireflies";
import { clearGameStorage } from "~/lib/helpers";
import { formatUntil } from "~/lib/moderation";

/** Shown in place of the game while the account is banned. */
export function AccountSuspended({
  bannedUntil,
  reason,
}: {
  bannedUntil: number;
  reason: string | null;
}) {
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    await signOut();
    clearGameStorage();
    window.location.assign("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center forest-bg relative p-4">
      <Fireflies count={20} />
      <Card className="w-full max-w-md forest-card box-glow-gold relative z-10">
        <div className="space-y-4 p-8 text-center">
          <h1 className="font-heading text-3xl text-blood-light">Account suspended</h1>
          <p className="text-sm text-foreground/85">
            This account is suspended {formatUntil(bannedUntil)}.
          </p>
          {reason && <p className="text-sm text-muted-foreground">Reason: {reason}</p>}
          <p className="text-xs text-muted-foreground">
            If you think this is a mistake, contact the server admins.
          </p>
          <Button type="button" variant="outline" onClick={() => void handleSignOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
