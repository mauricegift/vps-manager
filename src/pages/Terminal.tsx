import { useState, useRef, useEffect, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { TerminalIcon, Trash2 } from "lucide-react";
import AnsiText from "@/components/ui/AnsiText";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useTheme } from "@/context/ThemeContext";

interface Line { type: "input" | "output" | "error" | "system"; text: string; }

const DARK_THEME = {
  bg: "#1e1e2e",
  inputBar: "#181825",
  text: "#cdd6f4",
  muted: "#6c7086",
  prompt: "#a6e22e",
  error: "#f38ba8",
  system: "#6c7086",
  border: "#313244",
  btn: "#313244",
  btnHover: "#45475a",
};

const LIGHT_THEME = {
  bg: "#ffffff",
  inputBar: "#f4f4f5",
  text: "#1a1a1a",
  muted: "#888888",
  prompt: "#16803c",
  error: "#dc2626",
  system: "#6b7280",
  border: "#e4e4e7",
  btn: "#e4e4e7",
  btnHover: "#d4d4d8",
};

const CTRL_KEYS = [
  { label: "^C", title: "Ctrl+C — Interrupt", raw: "\x03", isInterrupt: true },
  { label: "^Z", title: "Ctrl+Z — Suspend", raw: "\x1a" },
  { label: "^D", title: "Ctrl+D — EOF", raw: "\x04" },
  { label: "ESC", title: "Escape", raw: "\x1b" },
  { label: "TAB", title: "Tab completion", raw: "\t" },
  { label: "↑", title: "Previous command", raw: "__HIST_UP__" },
  { label: "↓", title: "Next command", raw: "__HIST_DOWN__" },
];

export default function TerminalPage() {
  const { activeServer } = useRemoteServer();
  const { theme } = useTheme();
  const MONOKAI = theme === "dark" ? DARK_THEME : LIGHT_THEME;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("~");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const addLine = useCallback((type: Line["type"], text: string) => {
    setLines(prev => [...prev, { type, text }]);
  }, []);

  useEffect(() => {
    setLines([
      { type: "system", text: activeServer
        ? `SSH Terminal — ${activeServer.username}@${activeServer.ip} (${activeServer.name})`
        : "Local Shell Terminal" },
      { type: "system", text: 'Type commands and press Enter. "clear" clears the screen.' },
    ]);
    setInput("");
    setCwd("~");

    const query: Record<string, string> = {};
    if (activeServer) query.serverId = String(activeServer.id);

    const s = io({ path: "/socket.io", query, transports: ["websocket", "polling"] });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      setConnected(true);
      addLine("system", activeServer
        ? `✓ Connected via SSH → ${activeServer.username}@${activeServer.ip}`
        : "✓ Shell ready");
    });
    s.on("disconnect", () => { setConnected(false); addLine("system", "✗ Disconnected"); });
    s.on("output", (data: string) => addLine("output", data));
    s.on("error", (data: string) => addLine("error", data));
    s.on("system", (data: string) => addLine("system", data));
    s.on("cwd", (data: string) => setCwd(data));

    return () => { s.disconnect(); socketRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer?.id]);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [lines]);

  const send = () => {
    const s = socketRef.current;
    if (!input.trim() || !s || !connected) return;
    const cmd = input.trim();
    if (cmd === "clear") { setLines([]); setInput(""); return; }
    addLine("input", `${cwd}$ ${cmd}`);
    s.emit("command", cmd);
    setHistory(h => [cmd, ...h.slice(0, 99)]);
    setHistIdx(-1);
    setInput("");
  };

  const histUp = () => {
    const next = Math.min(histIdx + 1, history.length - 1);
    setHistIdx(next);
    setInput(history[next] || "");
    setTimeout(() => inputRef.current?.setSelectionRange(9999, 9999), 0);
  };

  const histDown = () => {
    const next = Math.max(histIdx - 1, -1);
    setHistIdx(next);
    setInput(next === -1 ? "" : history[next]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { send(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); histUp(); }
    if (e.key === "ArrowDown") { e.preventDefault(); histDown(); }
    if (e.key === "c" && e.ctrlKey) {
      socketRef.current?.emit("interrupt");
      addLine("system", "^C");
      setInput("");
    }
    if (e.key === "Tab") {
      e.preventDefault();
      socketRef.current?.emit("key", "\t");
    }
  };

  const pressCtrlKey = (key: typeof CTRL_KEYS[number]) => {
    const s = socketRef.current;
    if (!s) return;
    if (key.raw === "__HIST_UP__") { histUp(); inputRef.current?.focus(); return; }
    if (key.raw === "__HIST_DOWN__") { histDown(); inputRef.current?.focus(); return; }
    if (key.isInterrupt) {
      s.emit("interrupt");
      addLine("system", "^C");
      setInput("");
    } else {
      s.emit("key", key.raw);
    }
    inputRef.current?.focus();
  };

  const chromeTitle = activeServer
    ? `${activeServer.username}@${activeServer.ip}:${cwd}`
    : `shell:${cwd}`;

  return (
    <section className="main space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Terminal</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer ? `SSH · ${activeServer.name} (${activeServer.ip})` : "Execute commands on the local server"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${connected ? "text-green-500" : "text-red-400"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-400"}`} />
            {connected ? (activeServer ? "SSH Connected" : "Connected") : "Disconnected"}
          </div>
          <button
            onClick={() => setLines([])}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      {/* Terminal window — always Monokai dark */}
      <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ border: `1px solid ${MONOKAI.border}` }}>

        {/* Chrome bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b"
          style={{ background: MONOKAI.inputBar, borderColor: MONOKAI.border }}>
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
            <div className="w-3 h-3 rounded-full bg-amber-400 opacity-80" />
            <div className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
          </div>
          <div className="flex-1 text-center text-xs font-mono truncate" style={{ color: MONOKAI.muted }}>
            {chromeTitle}
          </div>
          <TerminalIcon size={13} style={{ color: MONOKAI.muted }} />
        </div>

        {/* Output */}
        <div
          ref={outputRef}
          onClick={() => inputRef.current?.focus()}
          className="h-[52vh] min-h-[260px] overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed cursor-text"
          style={{ background: MONOKAI.bg, color: MONOKAI.text }}
        >
          {lines.map((line, i) => {
            if (line.type === "system") {
              return (
                <div key={i} style={{ color: MONOKAI.system, fontStyle: "italic" }}>
                  {line.text}
                </div>
              );
            }
            if (line.type === "input") {
              return (
                <div key={i} style={{ color: MONOKAI.prompt, fontWeight: 600 }}>
                  <AnsiText text={line.text} />
                </div>
              );
            }
            if (line.type === "error") {
              return (
                <div key={i} style={{ color: MONOKAI.error }}>
                  <AnsiText text={line.text} />
                </div>
              );
            }
            return (
              <div key={i} style={{ color: MONOKAI.text }}>
                <AnsiText text={line.text} />
              </div>
            );
          })}
          <div style={{ height: 1 }} />
        </div>

        {/* Mobile control keys */}
        <div
          className="flex gap-1.5 px-3 py-2 overflow-x-auto hide-scrollbar border-t"
          style={{ background: MONOKAI.inputBar, borderColor: MONOKAI.border }}
        >
          {CTRL_KEYS.map(key => (
            <button
              key={key.label}
              title={key.title}
              onClick={() => pressCtrlKey(key)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-colors active:scale-95"
              style={{ background: MONOKAI.btn, color: MONOKAI.text }}
              onMouseEnter={e => (e.currentTarget.style.background = MONOKAI.btnHover)}
              onMouseLeave={e => (e.currentTarget.style.background = MONOKAI.btn)}
            >
              {key.label}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-t"
          style={{ background: MONOKAI.inputBar, borderColor: MONOKAI.border }}
        >
          <span className="font-mono text-sm shrink-0 font-bold" style={{ color: MONOKAI.prompt }}>
            {cwd}$
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!connected}
            placeholder={connected ? "Enter command..." : "Connecting..."}
            className="flex-1 bg-transparent font-mono text-sm focus:outline-none"
            style={{ color: MONOKAI.text, caretColor: MONOKAI.prompt }}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
          <button
            onClick={send}
            disabled={!connected || !input.trim()}
            className="shrink-0 p-1.5 rounded-lg transition-opacity disabled:opacity-30"
            style={{ background: MONOKAI.prompt }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#272822" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Quick Commands */}
      <div className="glass-card p-4">
        <div className="text-xs text-[var(--muted)] mb-2.5 font-semibold uppercase tracking-wider">Quick Commands</div>
        <div className="flex flex-wrap gap-2">
          {["uptime", "df -h", "free -h", "top -bn1 | head -20", "pm2 list", "docker ps", "ls -la", "netstat -tlnp", "cat /proc/cpuinfo | head -20", "journalctl -n 50"].map(cmd => (
            <button
              key={cmd}
              onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 font-mono transition-colors"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
