import { useSearchParams } from "react-router";
import { LeaderboardPanel } from "~/components/leaderboard/LeaderboardPanel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { Card } from "~/components/ui/card";

type BoardFilter = "all" | "experience" | "tier" | "rebirth";

const BOARD_FILTERS: Array<{ value: BoardFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "experience", label: "XP" },
  { value: "tier", label: "Tier" },
  { value: "rebirth", label: "Rebirths" },
];

function isBoardFilter(value: string | null): value is BoardFilter {
  return (
    value === "all" ||
    value === "experience" ||
    value === "tier" ||
    value === "rebirth"
  );
}

/**
 * /board?by=all|experience|tier|rebirth
 * Deep-linkable board filter; defaults to showing every leaderboard.
 */
export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("by");
  const filter: BoardFilter = isBoardFilter(requested) ? requested : "all";

  const handleChange = (value: string) => {
    if (!isBoardFilter(value)) return;
    const next = new URLSearchParams(searchParams);
    if (value === "all") {
      next.delete("by");
    } else {
      next.set("by", value);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Card className="forest-card gap-0 p-0">
        <Tabs value={filter} onValueChange={handleChange} className="gap-0">
          <div className="min-h-8 overflow-x-auto overflow-y-hidden border-b border-forest-light/30">
            <TabsList
              variant="forest"
              aria-label="Leaderboard filter"
              className="min-w-max"
            >
              {BOARD_FILTERS.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="p-4">
            <TabsContent value="all" className="outline-none">
              <LeaderboardPanel />
            </TabsContent>
            <TabsContent value="experience" className="outline-none">
              <LeaderboardPanel only="experience" />
            </TabsContent>
            <TabsContent value="tier" className="outline-none">
              <LeaderboardPanel only="tier" />
            </TabsContent>
            <TabsContent value="rebirth" className="outline-none">
              <LeaderboardPanel only="rebirth" />
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}
