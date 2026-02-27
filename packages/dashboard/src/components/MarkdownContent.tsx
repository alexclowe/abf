'use client';

import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

const components = {
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="bg-slate-700 text-sky-300 px-1.5 py-0.5 rounded text-[0.85em]" {...props}>
          {children}
        </code>
      );
    }
    return <code className={className} {...props}>{children}</code>;
  },
  blockquote: ({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="border-l-4 border-sky-500 pl-4 italic text-slate-400 my-3"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full border-collapse border border-slate-700 text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-slate-700 px-3 py-1.5 bg-slate-800 text-left font-medium" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-slate-700 px-3 py-1.5" {...props}>{children}</td>
  ),
};

export function MarkdownContent({
  children,
  isStreaming,
}: {
  children: string;
  isStreaming?: boolean;
}) {
  return (
    <Streamdown
      className="streamdown prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-3"
      plugins={{ code }}
      shikiTheme={['github-dark', 'github-dark']}
      isAnimating={isStreaming}
      components={components}
    >
      {children}
    </Streamdown>
  );
}
