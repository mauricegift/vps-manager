import { useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import hljs from "highlight.js/lib/core";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import ini from "highlight.js/lib/languages/ini";
import nginx from "highlight.js/lib/languages/nginx";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import php from "highlight.js/lib/languages/php";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("php", php);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);

const EXT_MAP: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", jsx: "javascript",
  py: "python", pyw: "python",
  json: "json", jsonc: "json",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  go: "go",
  rs: "rust",
  css: "css", scss: "css", sass: "css",
  html: "html", htm: "html", xml: "xml", svg: "xml",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
  md: "markdown", mdx: "markdown",
  ini: "ini", cfg: "ini", conf: "ini", env: "ini",
  nginx: "nginx",
  dockerfile: "dockerfile",
  php: "php",
  java: "java",
  cpp: "cpp", cc: "cpp", cxx: "cpp", c: "cpp", h: "cpp",
  toml: "ini",
};

export function getLang(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile") return "bash";
  if (lower.startsWith(".env")) return "ini";
  if (lower === "nginx.conf" || lower.includes("nginx")) return "nginx";
  const ext = lower.split(".").pop() || "";
  return EXT_MAP[ext] || null;
}

const DARK_STYLES = `
  .hljs { background: transparent !important; padding: 0; }
  .hljs-keyword, .hljs-built_in { color: #cba6f7; }
  .hljs-string, .hljs-attr { color: #a6e3a1; }
  .hljs-comment { color: #6c7086; font-style: italic; }
  .hljs-number, .hljs-literal { color: #fab387; }
  .hljs-variable, .hljs-params { color: #89dceb; }
  .hljs-function, .hljs-title { color: #89b4fa; }
  .hljs-type, .hljs-class { color: #f9e2af; }
  .hljs-tag { color: #f38ba8; }
  .hljs-attribute { color: #cba6f7; }
  .hljs-name { color: #f38ba8; }
  .hljs-selector-tag { color: #cba6f7; }
  .hljs-selector-class { color: #a6e3a1; }
  .hljs-meta { color: #f38ba8; }
  .hljs-punctuation { color: #cdd6f4; }
  .hljs-operator { color: #89dceb; }
  .hljs-symbol { color: #f9e2af; }
  .hljs-regexp { color: #f38ba8; }
  .hljs-section { color: #89b4fa; font-weight: bold; }
  .hljs-bullet { color: #fab387; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: bold; }
`;

const LIGHT_STYLES = `
  .hljs { background: transparent !important; padding: 0; }
  .hljs-keyword, .hljs-built_in { color: #7c3aed; }
  .hljs-string, .hljs-attr { color: #16a34a; }
  .hljs-comment { color: #6b7280; font-style: italic; }
  .hljs-number, .hljs-literal { color: #ea580c; }
  .hljs-variable, .hljs-params { color: #0891b2; }
  .hljs-function, .hljs-title { color: #2563eb; }
  .hljs-type, .hljs-class { color: #b45309; }
  .hljs-tag { color: #dc2626; }
  .hljs-attribute { color: #7c3aed; }
  .hljs-name { color: #dc2626; }
  .hljs-selector-tag { color: #7c3aed; }
  .hljs-selector-class { color: #16a34a; }
  .hljs-meta { color: #dc2626; }
  .hljs-punctuation { color: #374151; }
  .hljs-operator { color: #0891b2; }
  .hljs-symbol { color: #b45309; }
  .hljs-regexp { color: #dc2626; }
  .hljs-section { color: #2563eb; font-weight: bold; }
  .hljs-bullet { color: #ea580c; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: bold; }
`;

// Shared font metrics — must be identical between pre and textarea for overlay alignment
const FONT_FAMILY = '"ui-monospace","SFMono-Regular","Menlo","Consolas",monospace';
const FONT_SIZE = "11px";
const LINE_HEIGHT = "1.625"; // matches Tailwind leading-relaxed

interface ViewProps {
  code: string;
  filename: string;
  className?: string;
}

export default function CodeView({ code, filename, className = "" }: ViewProps) {
  const ref = useRef<HTMLElement>(null);
  const { theme } = useTheme();

  const dark = theme === "dark";
  const bg = dark ? "#1e1e2e" : "#f8fafc";
  const textColor = dark ? "#cdd6f4" : "#1e293b";

  useEffect(() => {
    if (!ref.current) return;
    ref.current.removeAttribute("data-highlighted");
    const lang = getLang(filename);
    if (lang && hljs.getLanguage(lang)) {
      ref.current.className = `language-${lang}`;
      ref.current.textContent = code;
      hljs.highlightElement(ref.current);
    } else {
      ref.current.textContent = code;
    }
  }, [code, filename, theme]);

  const lineCount = code.split("\n").length;
  const gutterBg = dark ? "#181825" : "#f1f5f9";
  const gutterColor = dark ? "#4a4a6a" : "#94a3b8";
  const gutterBorder = dark ? "#2a2a3e" : "#e2e8f0";
  const gutterWidth = String(lineCount).length * 8 + 24;

  return (
    <div
      className={`rounded-xl overflow-hidden border border-[var(--line)] ${className}`}
      style={{ background: bg, fontFamily: FONT_FAMILY, fontSize: FONT_SIZE }}
    >
      <style>{dark ? DARK_STYLES : LIGHT_STYLES}</style>
      <div className="overflow-auto" style={{ maxHeight: "55vh" }}>
        <div className="flex min-h-full">
          <div
            className="select-none shrink-0 py-4 text-right leading-relaxed"
            style={{
              width: gutterWidth,
              paddingLeft: 8,
              paddingRight: 12,
              background: gutterBg,
              borderRight: `1px solid ${gutterBorder}`,
              color: gutterColor,
              fontFamily: FONT_FAMILY,
              fontSize: FONT_SIZE,
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i + 1}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 m-0 py-4 px-4 overflow-visible" style={{ color: textColor }}>
            <code ref={ref}>{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── SyntaxEditor ─────────────────────────────────────────────────────────────
// Editable code editor with live syntax highlighting.
// Uses the "overlay" technique: a transparent textarea sits on top of a
// highlight.js-rendered <pre><code> in the same CSS Grid cell so the user
// types in the textarea but sees coloured tokens beneath.

interface EditorProps {
  value: string;
  onChange: (v: string) => void;
  filename: string;
  className?: string;
}

export function SyntaxEditor({ value, onChange, filename, className = "" }: EditorProps) {
  const codeRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const dark = theme === "dark";

  const bg = dark ? "#1e1e2e" : "#f8fafc";
  const textColor = dark ? "#cdd6f4" : "#1e293b";
  const gutterBg = dark ? "#181825" : "#f1f5f9";
  const gutterBorder = dark ? "#2a2a3e" : "#e2e8f0";
  const gutterColor = dark ? "#4a4a6a" : "#94a3b8";

  const lineCount = (value + "\n").split("\n").length;
  const gutterWidth = String(lineCount).length * 8 + 24;

  // Re-highlight on every value or theme change
  useEffect(() => {
    if (!codeRef.current) return;
    codeRef.current.removeAttribute("data-highlighted");
    const lang = getLang(filename);
    // Add trailing newline so the highlighted block is always at least as tall
    // as the textarea (prevents last-line misalignment)
    const display = value.endsWith("\n") ? value + " " : value;
    if (lang && hljs.getLanguage(lang)) {
      codeRef.current.className = `language-${lang}`;
      codeRef.current.textContent = display;
      hljs.highlightElement(codeRef.current);
    } else {
      codeRef.current.textContent = display;
    }
  }, [value, filename, dark]);

  // Keep gutter in sync when the editor area scrolls
  const syncGutter = useCallback(() => {
    if (editorRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);

  // Tab key → insert 2 spaces instead of moving focus
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.substring(0, start) + "  " + value.substring(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
      }
    });
  }, [value, onChange]);

  const sharedStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    padding: "16px",
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    overflowWrap: "break-word",
    tabSize: 2,
  };

  return (
    <div
      className={`rounded-xl overflow-hidden border border-[var(--line)] flex ${className}`}
      style={{ background: bg, minHeight: "300px", maxHeight: "55vh" }}
    >
      <style>{dark ? DARK_STYLES : LIGHT_STYLES}</style>

      {/* Line number gutter — sync-scrolls with editor */}
      <div
        ref={gutterRef}
        className="select-none shrink-0 overflow-hidden"
        style={{
          width: gutterWidth,
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 8,
          paddingRight: 12,
          textAlign: "right",
          background: gutterBg,
          borderRight: `1px solid ${gutterBorder}`,
          color: gutterColor,
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i + 1}>{i + 1}</div>
        ))}
      </div>

      {/* Editor area — scrollable wrapper */}
      <div
        ref={editorRef}
        onScroll={syncGutter}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
      >
        {/*
          CSS Grid overlay: both <pre> and <textarea> share the same grid cell.
          The pre renders coloured tokens (pointer-events: none, user-select: none).
          The textarea floats on top with transparent text + matching caret colour
          so the user edits the text while seeing the highlighted layer beneath.
        */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", minHeight: "100%" }}>
          {/* Highlighted layer */}
          <pre
            aria-hidden
            style={{
              ...sharedStyle,
              gridArea: "1 / 1 / 2 / 2",
              color: textColor,
              pointerEvents: "none",
              userSelect: "none",
              overflow: "hidden",
            }}
          >
            <code ref={codeRef} />
          </pre>

          {/* Editable layer */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              ...sharedStyle,
              gridArea: "1 / 1 / 2 / 2",
              background: "transparent",
              color: "transparent",
              caretColor: textColor,
              border: "none",
              outline: "none",
              resize: "none",
              zIndex: 1,
            }}
          />
        </div>
      </div>
    </div>
  );
}
