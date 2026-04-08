import { useMemo } from "react";
import AnsiToHtml from "ansi-to-html";

const converter = new AnsiToHtml({
  fg: "#e0e0e0",
  bg: "#111111",
  newline: true,
  escapeXML: true,
  stream: false,
  colors: {
    0: "#1a1a1a",
    1: "#f44747",
    2: "#4ec994",
    3: "#e5c07b",
    4: "#61afef",
    5: "#c678dd",
    6: "#56b6c2",
    7: "#abb2bf",
    8: "#545862",
    9: "#ef596f",
    10: "#89ca78",
    11: "#e5c07b",
    12: "#61afef",
    13: "#d55fde",
    14: "#2bbac5",
    15: "#d0d0d0",
  },
});

export function cleanTerminal(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[\?[0-9;]*[hl]/g, "")
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKLMSTfnsu]/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/\x1bM/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[^\n]*\r([^\n\r])/g, "$1")
    .replace(/\r/g, "");
}

interface Props {
  text: string;
  className?: string;
}

export default function AnsiText({ text, className }: Props) {
  const html = useMemo(() => {
    try {
      return converter.toHtml(cleanTerminal(text));
    } catch {
      return cleanTerminal(text).replace(/\x1b\[[0-9;]*m/g, "");
    }
  }, [text]);

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
    />
  );
}
