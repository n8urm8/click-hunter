import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "~/components/ui/button";
import {
  useLiftModeration,
  useModerationLog,
  usePlayerModeration,
} from "~/hooks/useModeration";
import { toErrorMessage } from "~/lib/errorMessage";
import { convexQueryCacheOptions } from "~/lib/queryCache";
import { formatUntil, isActiveUntil } from "~/lib/moderation";

type ReportStatus = "open" | "actioned" | "dismissed";

const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

type ModerationAction =
  | { kind: "mute"; minutes: number }
  | { kind: "ban"; days?: number };

type ModerationChoice = {
  label: string;
  action: ModerationAction;
  confirm?: string;
};

const MODERATION_CHOICES: ModerationChoice[] = [
  { label: "Mute 1h", action: { kind: "mute", minutes: 60 } },
  { label: "Mute 24h", action: { kind: "mute", minutes: 24 * 60 } },
  { label: "Mute 7d", action: { kind: "mute", minutes: 7 * 24 * 60 } },
  { label: "Ban 7d", action: { kind: "ban", days: 7 } },
  {
    label: "Ban permanently",
    action: { kind: "ban" },
    confirm:
      "Ban this account permanently? It cannot play until a moderator lifts the ban.",
  },
];

const LOG_ACTION_LABELS = {
  mute: "Muted",
  unmute: "Unmuted",
  ban: "Banned",
  unban: "Unbanned",
} as const;

type ReportRow = {
  _id: Id<"chatReports">;
  reportedPlayerId: Id<"players">;
  reportedPlayerName: string;
  reporterName: string;
  channelType: string;
  reason: string;
  details?: string;
  createdAt: number;
  messageId: Id<"chatMessages">;
  status: ReportStatus;
  context: Array<{
    messageId: Id<"chatMessages">;
    senderName: string;
    content: string;
    createdAt: number;
  }>;
};

/** Admin queue of player reports, with the saved messages around each one. */
export function ChatReportsPanel({ playerId }: { playerId: Id<"players"> }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [error, setError] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<Id<"chatReports"> | null>(null);
  const reports = useQuery({
    ...convexQuery(api.chat.listReports, { playerId, status }),
    ...convexQueryCacheOptions,
  });
  const resolve = useMutation(api.chat.resolveReport);
  const liftModeration = useLiftModeration();

  const handleResolve = (
    report: ReportRow,
    nextStatus: "actioned" | "dismissed",
    choice?: ModerationChoice,
    note?: string
  ) => {
    if (choice?.confirm && !window.confirm(choice.confirm)) return;
    setError(null);
    setBusyReportId(report._id);
    resolve({
      playerId,
      reportId: report._id,
      status: nextStatus,
      ...(choice ? { action: choice.action } : {}),
      ...(note ? { note } : {}),
    })
      .catch((resolveError: unknown) => {
        setError(toErrorMessage(resolveError, "Unable to update report."));
      })
      .finally(() => setBusyReportId(null));
  };

  const handleLift = (targetPlayerId: Id<"players">, kind: "mute" | "ban") => {
    setError(null);
    liftModeration({ playerId, targetPlayerId, kind }).catch((liftError: unknown) => {
      setError(toErrorMessage(liftError, "Unable to lift the restriction."));
    });
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
        <ReportCard
          key={report._id}
          report={report}
          playerId={playerId}
          busy={busyReportId === report._id}
          onResolve={handleResolve}
          onLift={handleLift}
        />
      ))}
      <ModerationLog playerId={playerId} />
    </section>
  );
}

function ReportCard({
  report,
  playerId,
  busy,
  onResolve,
  onLift,
}: {
  report: ReportRow;
  playerId: Id<"players">;
  busy: boolean;
  onResolve: (
    report: ReportRow,
    status: "actioned" | "dismissed",
    choice?: ModerationChoice,
    note?: string
  ) => void;
  onLift: (targetPlayerId: Id<"players">, kind: "mute" | "ban") => void;
}) {
  const [note, setNote] = useState("");
  const trimmedNote = note.trim();

  return (
    <article className="space-y-3 border border-forest-light/30 p-4">
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
      <AccountStatusLine
        playerId={playerId}
        targetPlayerId={report.reportedPlayerId}
        disabled={busy}
        onLift={onLift}
      />
      {report.status === "open" && (
        <div className="space-y-2">
          <input
            type="text"
            aria-label="Moderator note"
            placeholder="Note for the log (optional, defaults to the report reason)"
            value={note}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
            className="w-full border border-forest-light/40 bg-forest-dark/50 px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-gold/50"
          />
          <div className="flex flex-wrap gap-2">
            {MODERATION_CHOICES.map((choice) => (
              <Button
                key={choice.label}
                type="button"
                size="sm"
                variant={choice.action.kind === "ban" ? "destructive" : "outline"}
                disabled={busy}
                onClick={() => onResolve(report, "actioned", choice, trimmedNote || undefined)}
              >
                {choice.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onResolve(report, "actioned")}
            >
              Mark actioned
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onResolve(report, "dismissed")}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function AccountStatusLine({
  playerId,
  targetPlayerId,
  disabled,
  onLift,
}: {
  playerId: Id<"players">;
  targetPlayerId: Id<"players">;
  disabled: boolean;
  onLift: (targetPlayerId: Id<"players">, kind: "mute" | "ban") => void;
}) {
  const moderation = usePlayerModeration(playerId, targetPlayerId);
  if (moderation.isPending) {
    return <p className="text-xs text-muted-foreground">Checking account status...</p>;
  }
  if (!moderation.data) return null;

  const now = Date.now();
  const { mutedUntil, muteReason, bannedUntil, banReason } = moderation.data;
  const muted = isActiveUntil(mutedUntil, now);
  const banned = isActiveUntil(bannedUntil, now);
  if (!muted && !banned) {
    return <p className="text-xs text-muted-foreground">Account: no active mute or ban.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="font-semibold text-gold-light">Account:</span>
      {banned && (
        <span className="flex items-center gap-2 text-blood-light">
          Banned {formatUntil(bannedUntil)}
          {banReason ? ` (${banReason})` : ""}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => onLift(targetPlayerId, "ban")}
          >
            Lift ban
          </Button>
        </span>
      )}
      {muted && (
        <span className="flex items-center gap-2 text-blood-light">
          Muted {formatUntil(mutedUntil)}
          {muteReason ? ` (${muteReason})` : ""}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => onLift(targetPlayerId, "mute")}
          >
            Lift mute
          </Button>
        </span>
      )}
    </div>
  );
}

function ModerationLog({ playerId }: { playerId: Id<"players"> }) {
  const log = useModerationLog(playerId);

  return (
    <section className="space-y-3 border-t border-forest-light/25 pt-4">
      <h3 className="font-semibold text-gold-light">Moderation log</h3>
      {log.isPending && <p className="text-sm text-muted-foreground">Loading the log...</p>}
      {log.isError && !log.data && (
        <p role="alert" className="text-sm text-destructive">Unable to load the log.</p>
      )}
      {log.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No mutes or bans yet.</p>
      )}
      {log.data && log.data.length > 0 && (
        <ol className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {log.data.map((entry) => (
            <li key={entry._id}>
              <time className="mr-2 text-[10px] text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString()}
              </time>
              <span className="font-semibold">{LOG_ACTION_LABELS[entry.action]}</span>{" "}
              {entry.targetName}
              {entry.until !== undefined && (entry.action === "mute" || entry.action === "ban")
                ? ` ${formatUntil(entry.until)}`
                : ""}
              <span className="text-muted-foreground">
                {" "}— {entry.reason} (by {entry.actorName})
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
