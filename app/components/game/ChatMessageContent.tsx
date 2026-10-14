import { Link } from "react-router";

const URL_PATTERN = /https?:\/\/[^\s]+/g;
const TRAILING_PUNCTUATION = /[.,!?;)]+$/;

/**
 * Chat text with clickable links. Same-origin `/arena?lobby=` URLs (absolute
 * or relative, as produced by the lobby Share button) render as compact
 * in-app links so pasted lobbies are one tap to open; anything else becomes
 * a plain external anchor. Plain segments pass through untouched.
 */
export function ChatMessageContent({ content }: { content: string }) {
  const parts: Array<{ key: string; url?: string; text?: string }> = [];
  let last = 0;
  for (const match of content.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const url = raw.replace(TRAILING_PUNCTUATION, "");
    const trail = raw.slice(url.length);
    if (start > last) {
      parts.push({ key: `t${start}`, text: content.slice(last, start) });
    }
    if (url.length > 0) {
      parts.push({ key: `u${start}`, url });
    }
    if (trail.length > 0) {
      parts.push({ key: `p${start}`, text: trail });
    }
    last = start + raw.length;
  }
  if (last < content.length) {
    parts.push({ key: `t${last}`, text: content.slice(last) });
  }
  if (parts.length === 0) {
    return <>{content}</>;
  }
  return (
    <>
      {parts.map((part) =>
        part.url !== undefined ? (
          <ChatLink key={part.key} url={part.url} />
        ) : (
          <span key={part.key}>{part.text}</span>
        )
      )}
    </>
  );
}

function ChatLink({ url }: { url: string }) {
  let lobbyId: string | null = null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      parsed.pathname === "/arena"
    ) {
      lobbyId = parsed.searchParams.get("lobby");
    }
  } catch {
    lobbyId = null;
  }
  if (lobbyId) {
    return (
      <Link
        to={`/arena?lobby=${lobbyId}`}
        title={url}
        className="font-semibold text-gold-light underline decoration-gold/50 hover:text-gold"
      >
        Arena lobby
      </Link>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-gold-light underline decoration-gold/50 hover:text-gold"
    >
      {url}
    </a>
  );
}
