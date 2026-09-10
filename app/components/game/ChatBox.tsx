import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  useMarkPrivateChatRead,
  useChatMessages,
  usePrivateChats,
  useSendChatMessage,
} from "~/hooks/useChat";
import type { ChatChannelType } from "~/hooks/useChat";
import type { Id } from "../../../convex/_generated/dataModel";

const BOTTOM_THRESHOLD_PX = 12;

interface ChatPlayer {
  id: Id<"players">;
  name: string;
}

interface MessageActionTarget extends ChatPlayer {
  top: number;
  left: number;
}

interface ChatBoxProps {
  player: {
    _id: Id<"players">;
  };
}

const PRIVATE_POPOVER_WIDTH_PX = 144;
const PRIVATE_POPOVER_HEIGHT_PX = 36;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to send message.";
}

function formatChatTime(createdAt: number) {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChatBox({ player }: ChatBoxProps) {
  const [activeChannel, setActiveChannel] =
    useState<ChatChannelType>("world");
  const [recipient, setRecipient] = useState<ChatPlayer | null>(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [messageActionTarget, setMessageActionTarget] =
    useState<MessageActionTarget | null>(null);
  const messages = useChatMessages(
    player._id,
    activeChannel,
    recipient?.id ?? null
  );
  const privateChats = usePrivateChats(player._id);
  const markPrivateChatRead = useMarkPrivateChatRead();
  const sendMessage = useSendChatMessage();
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageActionRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const element = messageListRef.current;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true;
    setIsAtBottom(true);
  }, [activeChannel, recipient?.id]);

  useLayoutEffect(() => {
    if (messages && shouldStickToBottomRef.current) {
      scrollToBottom();
    }
  }, [activeChannel, messages, recipient?.id, scrollToBottom]);

  useEffect(() => {
    if (!messageActionTarget) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        messageActionRef.current?.contains(event.target)
      ) {
        return;
      }
      setMessageActionTarget(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMessageActionTarget(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [messageActionTarget]);

  const handleMessageListScroll = () => {
    const element = messageListRef.current;
    if (!element) return;

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    shouldStickToBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  };

  const handleChannelChange = (channel: ChatChannelType) => {
    if (channel === "private" && activeChannel !== "private") {
      setRecipient(null);
    }
    setActiveChannel(channel);
    setSendError(null);
    setMessageActionTarget(null);
  };

  const handleRecipientSelect = (selectedRecipient: ChatPlayer) => {
    setRecipient(selectedRecipient);
    setActiveChannel("private");
    setSendError(null);
    setMessageActionTarget(null);
    void markPrivateChatRead({
      playerId: player._id,
      recipientId: selectedRecipient.id,
    }).catch((error) => {
      setSendError(getErrorMessage(error));
    });
  };

  const handleMessageSenderClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    senderId: Id<"players"> | undefined,
    senderName: string
  ) => {
    if (!senderId || senderId === player._id) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(bounds.left, 8),
      window.innerWidth - PRIVATE_POPOVER_WIDTH_PX - 8
    );
    const preferredTop = bounds.bottom + 4;
    const top =
      preferredTop + PRIVATE_POPOVER_HEIGHT_PX > window.innerHeight
        ? Math.max(8, bounds.top - PRIVATE_POPOVER_HEIGHT_PX - 4)
        : preferredTop;

    setMessageActionTarget({
      id: senderId,
      name: senderName,
      top,
      left,
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending || (activeChannel === "private" && !recipient)) {
      return;
    }

    setIsSending(true);
    setSendError(null);
    try {
      await sendMessage({
        playerId: player._id,
        channelType: activeChannel,
        ...(activeChannel === "private" && recipient
          ? { recipientId: recipient.id }
          : {}),
        content,
      });
      setDraft("");
    } catch (error) {
      setSendError(getErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const hasRecipient = activeChannel === "world" || recipient !== null;
  const canSend =
    hasRecipient && draft.trim().length > 0 && draft.length <= MAX_CHAT_MESSAGE_LENGTH;
  const hasUnreadPrivateMessages =
    privateChats?.some((chat) => chat.hasUnread) ?? false;

  return (
    <section className="forest-card box-glow-green rounded-none p-0" aria-label="Chat">
      <div
        className="mb-0 inline-flex items-center gap-0 rounded-none border border-forest-light/30 bg-forest-dark/60 p-0"
        role="tablist"
        aria-label="Chat channel"
      >
        {(["world", "private"] as const).map((channel) => (
          <button
            key={channel}
            type="button"
            role="tab"
            aria-selected={activeChannel === channel}
            onClick={() => handleChannelChange(channel)}
            className={`rounded-none px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase transition-colors ${
              activeChannel === channel
                ? "bg-forest-mid text-gold-light"
                : "text-muted-foreground hover:bg-forest-mid/50 hover:text-foreground"
            }`}
          >
            {channel === "world" ? (
              "World"
            ) : (
              <span className="inline-flex items-center">
                Private
                {hasUnreadPrivateMessages && (
                  <span
                    aria-label="Unread private messages"
                    className="ml-1.5 size-1.5 rounded-full bg-gold"
                  />
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="relative">
        <div
          ref={messageListRef}
          onScroll={handleMessageListScroll}
          className="forest-panel h-[150px] overflow-y-auto rounded-none px-2 py-1"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {activeChannel === "private" && recipient && (
            <button
              type="button"
              onClick={() => setRecipient(null)}
              className="flex w-full items-center justify-between border-b border-forest-light/20 px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-forest-glow hover:text-gold-light"
            >
              <span>Private chats</span>
              <span className="normal-case text-muted-foreground">
                {recipient.name}
              </span>
            </button>
          )}

          {activeChannel === "private" && !recipient ? (
            privateChats === undefined ? (
              <p className="py-5 text-center text-sm text-muted-foreground">
                Gathering your private chats...
              </p>
            ) : privateChats.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">
                No private chats yet. Click a player name to start one.
              </p>
            ) : (
              <div>
                {privateChats.map((chat) => (
                  <button
                    key={chat.playerId}
                    type="button"
                    onClick={() =>
                      handleRecipientSelect({
                        id: chat.playerId,
                        name: chat.playerName,
                      })
                    }
                    className="flex w-full items-center justify-between border-b border-forest-light/20 px-1 py-1 text-left last:border-b-0 hover:bg-forest-mid/40"
                  >
                    <span className="inline-flex items-center text-sm text-gold-light">
                      {chat.playerName}
                      {chat.hasUnread && (
                        <span
                          aria-label="Unread message"
                          className="ml-1.5 size-1.5 shrink-0 rounded-full bg-gold"
                        />
                      )}
                    </span>
                    <time
                      dateTime={new Date(chat.lastMessageAt).toISOString()}
                      className="text-[10px] text-muted-foreground"
                    >
                      {formatChatTime(chat.lastMessageAt)}
                    </time>
                  </button>
                ))}
              </div>
            )
          ) : messages === undefined ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              Gathering the latest messages...
            </p>
          ) : messages.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation.
            </p>
          ) : (
            <div className="space-y-0">
              {messages.map((message) => {
                const isOwnMessage = message.senderId === player._id;
                const canStartPrivateChat =
                  message.senderId !== undefined && !isOwnMessage;

                return (
                  <div
                    key={message._id}
                    className={`flex w-full ${
                      isOwnMessage ? "justify-end" : "justify-start"
                    }`}
                  >
                    <p
                      className={`max-w-[85%] break-words text-sm leading-5 text-foreground/85 ${
                        isOwnMessage ? "text-right" : ""
                      }`}
                    >
                      {isOwnMessage ? (
                        <>
                          <span className="whitespace-pre-wrap break-words">
                            {message.content}
                          </span>{" "}
                          <span className="text-muted-foreground">:</span>
                          <time
                            dateTime={new Date(message.createdAt).toISOString()}
                            className="text-[10px] text-muted-foreground"
                          >
                            {formatChatTime(message.createdAt)}
                          </time>{" "}
                          <span className="font-semibold text-gold-light">
                            {message.senderName}
                          </span>
                        </>
                      ) : (
                        <>
                          {canStartPrivateChat ? (
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={
                                messageActionTarget?.id === message.senderId
                              }
                              onClick={(event) =>
                                handleMessageSenderClick(
                                  event,
                                  message.senderId,
                                  message.senderName
                                )
                              }
                              className="font-semibold text-gold-light hover:text-gold-light/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold"
                            >
                              {message.senderName}
                            </button>
                          ) : (
                            <span className="font-semibold text-gold-light">
                              {message.senderName}
                            </span>
                          )}{" "}
                          <time
                            dateTime={new Date(message.createdAt).toISOString()}
                            className="text-[10px] text-muted-foreground"
                          >
                            {formatChatTime(message.createdAt)}
                          </time>
                          <span className="text-muted-foreground">:</span>{" "}
                          <span className="whitespace-pre-wrap break-words">
                            {message.content}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isAtBottom && (
          <button
            type="button"
            onClick={() => {
              shouldStickToBottomRef.current = true;
              setIsAtBottom(true);
              scrollToBottom();
            }}
            className="absolute bottom-1 right-1 rounded-none border border-gold/40 bg-forest-dark px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-light shadow-lg"
          >
            Latest
          </button>
        )}
      </div>

      {messageActionTarget && (
        <div
          ref={messageActionRef}
          role="menu"
          aria-label={`Actions for ${messageActionTarget.name}`}
          className="fixed z-50 min-w-36 border border-gold/50 bg-forest-dark shadow-lg"
          style={{
            top: messageActionTarget.top,
            left: messageActionTarget.left,
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => handleRecipientSelect(messageActionTarget)}
            className="block w-full px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gold-light hover:bg-forest-mid focus-visible:bg-forest-mid focus-visible:outline-none"
          >
            Private message
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-0 space-y-0">
        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          rows={1}
          disabled={!hasRecipient || isSending}
          placeholder={
            hasRecipient ? "Write a message..." : "Choose a recipient first..."
          }
          className="min-h-9 w-full resize-none rounded-none border border-forest-light/40 bg-forest-dark/70 px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-gold/60 focus:ring-1 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-0">
          <div className="text-xs text-blood-light">
            {sendError}
          </div>
          <div className="flex items-center gap-0">
            <span className="text-xs text-muted-foreground">
              {draft.length}/{MAX_CHAT_MESSAGE_LENGTH}
            </span>
            <Button
              type="submit"
              size="xs"
              disabled={!canSend || isSending}
              className="rounded-none border border-gold/30 bg-forest-mid text-gold-light hover:bg-forest-light"
            >
              {isSending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
