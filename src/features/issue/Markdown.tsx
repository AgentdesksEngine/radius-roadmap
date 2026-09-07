import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
