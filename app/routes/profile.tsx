import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { AccountPanel } from "~/components/account/AccountPanel";
import { BlockedPlayersPanel } from "~/components/account/BlockedPlayersPanel";
import { useGamePlayer } from "./game";

export default function Profile() {
  const player = useGamePlayer();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Card className="forest-card box-glow-gold">
        <CardHeader>
          <CardTitle>Profile &amp; Settings</CardTitle>
          <CardDescription>
            Your account, and who you have blocked from chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-lg">{player.name}</p>
        </CardContent>
      </Card>
      <AccountPanel />
      <BlockedPlayersPanel playerId={player._id} />
    </div>
  );
}
