import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "~/components/ui/button";
import { convexQueryCacheOptions } from "~/lib/queryCache";

type ReportStatus = "open" | "actioned" | "dismissed";

const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

/** Admin queue of player reports, with the saved messages around each one. */
export function ChatReportsPanel({ playerId }: { playerId: Id<"players"> }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [error, setError] = useState<string | null>(null);
  const reports = useQuery({
    ...convexQuery(api.chat.listReports, { playerId, status }),
    ...convexQueryCacheOptions,
  });
  const resolve = useMutation(api.chat.resolveReport);

  const handleResolve = async (
    reportId: Id<"chatReports">,
    nextStatus: "actioned" | "dismissed"
  ) => {
    setError(null);
    try {
      await resolve({ playerId, reportId, status: nextStatus });
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Unable to update report.");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Report status">
        {(Object.keys(STATUS_LABELS) as ReportStatus[]).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={status === value ? "default" : "outline"}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {STATUS_LABELS[value]}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {reports.isPending && <p className="text-sm text-muted-foreground">Loading reports...</p>}
      {reports.isError && <p role="alert" className="text-sm text-destructive">Unable to load reports.</p>}
      {reports.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No {status} reports.</p>
      )}
      {reports.data?.map((report) => (
        <article key={report._id} className="space-y-3 border border-forest-light/30 p-4">
          <header className="space-y-1">
            <h3 className="font-semibold text-gold-light">
              {report.reportedPlayerName}
              <span className="ml-2 text-xs font-normal uppercase tracking-wider text-muted-foreground">
                {report.reason}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Reported by {report.reporterName} in {report.channelType} on{" "}
              {new Date(report.createdAt).toLocaleString()}
            </p>
            {report.details && <p className="text-sm text-foreground/85">{report.details}</p>}
          </header>
          <ol className="space-y-1 border-l border-forest-light/30 pl-3 text-sm">
            {report.context.map((message) => (
              <li
                key={message.messageId}
                className={message.messageId === report.messageId ? "font-semibold text-gold-light" : "text-foreground/85"}
              >
                <time className="mr-2 text-[10px] text-muted-foreground">
                  {new Date(message.createdAt).toLocaleString()}
                </time>
                {message.senderName}: <span className="whitespace-pre-wrap break-words">{message.content}</span>
              </li>
            ))}
          </ol>
          {report.status === "open" && (
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void handleResolve(report._id, "actioned")}>
                Mark actioned
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void handleResolve(report._id, "dismissed")}>
                Dismiss
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
