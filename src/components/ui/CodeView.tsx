import { useEffect, useRef } from "react";
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

interface Props {
  code: string;
  filename: string;
  className?: string;
}

export default function CodeView({ code, filename, className = "" }: Props) {
  const ref = useRef<HTMLElement>(null);
  const { theme } = useTheme();

  const dark = theme === "dark";
  const bg = dark ? "#1e1e2e" : "#f8fafc";
  const textColor = dark ? "#cdd6f4" : "#1e293b";

  const darkStyles = `
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

  const lightStyles = `
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

  return (
    <div
      className={`rounded-xl overflow-auto text-[11px] leading-relaxed border border-[var(--line)] ${className}`}
      style={{ background: bg, fontFamily: "monospace" }}
    >
      <style>{dark ? darkStyles : lightStyles}</style>
      <pre className="m-0 p-4 overflow-auto" style={{ color: textColor }}>
        <code ref={ref}>{code}</code>
      </pre>
    </div>
  );
}
