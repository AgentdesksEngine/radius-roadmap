import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * `mention:` is not a protocol rehype-sanitize knows, so without this it strips the href and
 * a mention renders as plain text. Allowing it is safe precisely because the `a` override
 * below never renders it as a link — it becomes a span.
 */
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'mention'],
  },
};

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{
          a: ({ node: _n, href, children: kids, ...p }) =>
            href?.startsWith('mention:') ? (
              <span className="mention">{kids}</span>
            ) : (
              <a {...p} href={href} target="_blank" rel="noreferrer">
                {kids}
              </a>
            ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
