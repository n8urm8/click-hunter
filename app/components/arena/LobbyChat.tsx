import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { ChatMessageContent } from "~/components/game/ChatMessageContent";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  useChatMessages,
  useSendChatMessage,
} from "~/hooks/useChat";
import type { Id } from "../../../convex/_generated/dataModel";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to send message.";
}

/**
 * Compact occupants-only chat for one arena lobby. Fighters and spectators
 * talk trash (or coordinate) without leaving the room; the server enforces
 * occupancy, so private rooms never leak here.
 */
export function LobbyChat({
  playerId,
  lobbyId,
}: {
  playerId: Id<"players">;
  lobbyId: Id<"arenaLobbies">;
}) {
  const messages = useChatMessages(playerId, "arena", null, lobbyId);
  const sendMessage = useSendChatMessage();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.data]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage({ playerId, channelType: "arena", lobbyId, content });
      setDraft("");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-label="Lobby chat" className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Lobby chat
      </h4>
      <div
        ref={listRef}
        className="max-h-32 overflow-y-auto rounded bg-zinc-900 px-3 py-2"
        aria-live="polite"
      >
        {messages.isPending ? (
          <p className="text-xs text-muted-foreground">Loading chat...</p>
        ) : (messages.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">
            No messages yet. Talk strategy — or trash.
          </p>
        ) : (
          <ul className="space-y-1">
            {messages.data?.map((message) => (
              <li key={message._id} className="text-xs leading-5">
                <span className="font-semibold text-gold-light">
                  {message.senderName}
                </span>
                <span className="text-muted-foreground">: </span>
                <span className="whitespace-pre-wrap break-words text-foreground/85">
                  <ChatMessageContent content={message.content} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={`lobby-chat-${lobbyId}`} className="sr-only">
          Lobby message
        </label>
        <input
          id={`lobby-chat-${lobbyId}`}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder="Message the room..."
          className="w-full rounded-lg border border-forest-light/40 bg-forest-dark/50 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/50"
        />
        <Button
          type="submit"
          size="xs"
          disabled={sending || draft.trim().length === 0}
        >
          {sending ? "Sending..." : "Send"}
        </Button>
      </form>
      {error && (
        <p className="text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
