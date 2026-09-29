import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { clearGameStorage } from "~/lib/helpers";
import { useGamePlayer } from "./game";

export default function Profile() {
  const player = useGamePlayer();

  const handleLogout = () => {
    clearGameStorage();
    window.location.assign("/");
  };

  return (
    <Card className="forest-card box-glow-gold mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Profile &amp; Settings</CardTitle>
        <CardDescription>
          Manage your player settings and account preferences here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="forest-panel flex flex-col gap-2 p-4">
          <p className="font-heading text-lg">{player.name}</p>
          <p className="text-sm text-muted-foreground">
            Profile settings are not available yet. Check back soon for more
            ways to customize your experience.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-forest-light/25 pt-4">
            <div>
              <p className="text-sm font-semibold">Session</p>
              <p className="text-xs text-muted-foreground">
                Log out and start a new character.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              className="border-blood-light/40 text-blood-light hover:border-blood-light/70 hover:bg-blood/20 hover:text-blood-light"
            >
              Log out
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
