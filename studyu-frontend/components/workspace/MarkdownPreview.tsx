"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  transformText?: (text: string) => ReactNode;
}

function Paragraph(props: HTMLAttributes<HTMLParagraphElement>) {
  return <p className="my-0 leading-6 [&:not(:last-child)]:mb-3" {...props} />;
}

function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
      target="_blank"
      rel="noreferrer noopener"
    />
  );
}

function transformNode(node: ReactNode, transformText?: (text: string) => ReactNode): ReactNode {
  if (!transformText) return node;
  if (typeof node === "string") {
    return transformText(node);
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => <span key={index}>{transformNode(child, transformText)}</span>);
  }
  if (isValidElement(node) && node.props) {
    const children = node.props.children as ReactNode;
    if (children === undefined) return node;
    return cloneElement(node, {
      ...node.props,
      children: Children.map(children, (child) => transformNode(child, transformText)),
    });
  }
  return node;
}

function TextAwareListItem(
  props: HTMLAttributes<HTMLLIElement> & { transformText?: (text: string) => ReactNode }
) {
  const { children, transformText, ...rest } = props;
  return <li {...rest}>{Children.map(children, (child) => transformNode(child, transformText))}</li>;
}

function TextAwareBlockquote(
  props: HTMLAttributes<HTMLQuoteElement> & { transformText?: (text: string) => ReactNode }
) {
  const { children, transformText, ...rest } = props;
  return <blockquote {...rest}>{Children.map(children, (child) => transformNode(child, transformText))}</blockquote>;
}

function TextAwareTableCell(
  props: HTMLAttributes<HTMLTableCellElement> & { transformText?: (text: string) => ReactNode }
) {
  const { children, transformText, ...rest } = props;
  return <td {...rest}>{Children.map(children, (child) => transformNode(child, transformText))}</td>;
}

function TextAwareTableHeader(
  props: HTMLAttributes<HTMLTableCellElement> & { transformText?: (text: string) => ReactNode }
) {
  const { children, transformText, ...rest } = props;
  return <th {...rest}>{Children.map(children, (child) => transformNode(child, transformText))}</th>;
}

export default function MarkdownPreview({ content, className, transformText }: MarkdownPreviewProps) {
  const TextAwareParagraph = (props: HTMLAttributes<HTMLParagraphElement>) => (
    <Paragraph {...props}>{Children.map(props.children, (child) => transformNode(child, transformText))}</Paragraph>
  );

  return (
    <div
      className={[
        "min-w-0 text-sm leading-6 break-words",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1.5",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_hr]:my-4 [&_hr]:border-gray-200",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-blue-200 [&_blockquote]:bg-blue-50/60 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:italic",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg",
        "[&_thead]:bg-gray-100/80",
        "[&_th]:border [&_th]:border-gray-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
        "[&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
        "[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.92em]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[#111827] [&_pre]:p-4 [&_pre]:text-gray-100",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
        className ?? "",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          p: TextAwareParagraph,
          li: (props) => <TextAwareListItem {...props} transformText={transformText} />,
          blockquote: (props) => <TextAwareBlockquote {...props} transformText={transformText} />,
          td: (props) => <TextAwareTableCell {...props} transformText={transformText} />,
          th: (props) => <TextAwareTableHeader {...props} transformText={transformText} />,
          a: Link,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
