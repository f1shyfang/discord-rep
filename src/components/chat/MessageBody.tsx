import type { ReactNode } from "react";
// A deliberately small Markdown subset. All text stays in React's escaping path.
export function MessageBody({
  body,
  people = [],
}: {
  body: string;
  people?: { id: string; displayName: string }[];
}) {
  const inline = (text: string): ReactNode[] =>
    text
      .split(
        /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|<@[0-9a-f-]{36}>)/g,
      )
      .map((part, i) => {
        if (part.startsWith("<@") && part.endsWith(">")) {
          const user = people.find((p) => p.id === part.slice(2, -1));
          return user ? <mark key={i}>@{user.displayName}</mark> : part;
        }
        if (part.startsWith("`"))
          return <code key={i}>{part.slice(1, -1)}</code>;
        if (part.startsWith("**"))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        return part;
      });
  return (
    <div className="message-body">
      {body.split(/(```[\s\S]*?```)/g).map((part, i) =>
        part.startsWith("```") ? (
          <pre key={i}>
            <code>{part.slice(3, -3).replace(/^\n/, "")}</code>
          </pre>
        ) : (
          <span key={i}>{inline(part)}</span>
        ),
      )}
    </div>
  );
}
