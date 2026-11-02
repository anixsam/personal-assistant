"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#05080e]">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-muted">
        <span className="font-mono">{lang || "code"}</span>
        <button
          className="inline-flex items-center gap-1 hover:text-fg"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scroll-thin overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-jarvis text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children ?? "");
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            if (!lang && !text.includes("\n")) return <code>{children}</code>;
            return <CodeBlock lang={lang ?? ""} code={text.replace(/\n$/, "")} />;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
