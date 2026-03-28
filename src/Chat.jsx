import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiUrl } from './config/server';
import { readJson, writeJson, readText, writeText } from './utils/persist';

const CHAT_MESSAGES_KEY = 'pocketide.chat.messages.v1';
const CHAT_INPUT_KEY = 'pocketide.chat.input.v1';
const CHAT_PENDING_REVIEW_KEY = 'pocketide.chat.pendingReviewPaths.v1';

function createMessageId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  if (msg.role === 'tool') {
    return {
      id: typeof msg.id === 'string' && msg.id ? msg.id : createMessageId(),
      turnId: typeof msg.turnId === 'string' ? msg.turnId : null,
      role: 'tool',
      tool: typeof msg.tool === 'string' ? msg.tool : 'unknown',
      done: Boolean(msg.done),
      input: msg.input ?? null,
      output: msg.output ?? null,
    };
  }

  if (['user', 'agent', 'reasoning', 'error'].includes(msg.role)) {
    return {
      id: typeof msg.id === 'string' && msg.id ? msg.id : createMessageId(),
      turnId: typeof msg.turnId === 'string' ? msg.turnId : null,
      role: msg.role,
      text: typeof msg.text === 'string' ? msg.text : '',
      streaming: Boolean(msg.streaming),
    };
  }

  return null;
}

function readInitialPendingReviewPaths() {
  const stored = readJson(CHAT_PENDING_REVIEW_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((value) => typeof value === 'string' && value.trim());
}

function readInitialMessages() {
  const fallback = [
    { id: createMessageId(), turnId: null, role: 'agent', text: 'Hello! I am your autonomous coding agent. How can I help?' },
  ];
  const stored = readJson(CHAT_MESSAGES_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return fallback;

  const next = stored
    .map(normalizeStoredMessage)
    .filter(Boolean);

  return next.length > 0 ? next : fallback;
}

// ── Message types ──────────────────────────────────────────────────────────
// { role: 'user',   text: string }
// { role: 'agent',  text: string, streaming?: bool }
// { role: 'tool',   tool: string, done?: bool, input?: unknown, output?: unknown }
// { role: 'error',  text: string }

function summarizeTool(tool, input) {
  const labelMap = {
    report_intent: 'Shared current intent',
    bash: 'Ran command in terminal',
    read_bash: 'Read terminal output',
    apply_patch: 'Edited workspace files',
    create_file: 'Created file',
    read_file: 'Read file',
    grep_search: 'Searched workspace text',
    file_search: 'Searched workspace files',
    semantic_search: 'Searched code semantically',
  };

  const base = labelMap[tool] || `Ran ${tool}`;
  if (typeof input === 'string' && input.trim()) {
    const compact = input.trim().replace(/\s+/g, ' ');
    return compact.length > 70 ? `${base}: ${compact.slice(0, 67)}...` : `${base}: ${compact}`;
  }
  if (input && typeof input === 'object') {
    if (typeof input.explanation === 'string' && input.explanation.trim()) {
      return input.explanation.trim();
    }
    if (typeof input.command === 'string' && input.command.trim()) {
      const compact = input.command.trim().replace(/\s+/g, ' ');
      return compact.length > 70 ? `${base}: ${compact.slice(0, 67)}...` : `${base}: ${compact}`;
    }
  }
  return base;
}

function formatToolPayload(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] px-3 py-2 rounded-xl text-sm
                      bg-vscode-accent/20 text-vscode-text break-words leading-relaxed border border-vscode-accent/40">
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}

function splitCodeBlocks(text) {
  const chunks = [];
  const re = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      chunks.push({ type: 'text', value: text.slice(last, m.index) });
    }
    chunks.push({ type: 'code', lang: m[1] || '', value: (m[2] || '').replace(/\n$/, '') });
    last = re.lastIndex;
  }

  if (last < text.length) {
    chunks.push({ type: 'text', value: text.slice(last) });
  }

  return chunks;
}

function InlineText({ line }) {
  const parts = line.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="px-1 py-0.5 rounded bg-vscode-sidebar border border-vscode-border font-mono text-[12px] text-vscode-text">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function TextBlock({ text }) {
  const lines = text.split('\n');
  return (
    <div className="text-sm text-vscode-text leading-7 whitespace-pre-wrap break-words">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-2" />;

        const isBullet = /^[-*]\s+/.test(trimmed);
        const isNumbered = /^\d+\.\s+/.test(trimmed);

        if (isBullet || isNumbered) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-vscode-text-muted">{isNumbered ? trimmed.match(/^\d+\./)?.[0] : '•'}</span>
              <span><InlineText line={trimmed.replace(/^([-*]|\d+\.)\s+/, '')} /></span>
            </div>
          );
        }

        if (/^#{1,3}\s+/.test(trimmed)) {
          return (
            <div key={idx} className="text-vscode-text font-semibold mt-1">
              <InlineText line={trimmed.replace(/^#{1,3}\s+/, '')} />
            </div>
          );
        }

        return (
          <div key={idx}>
            <InlineText line={line} />
          </div>
        );
      })}
    </div>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-vscode-border bg-vscode-sidebar overflow-hidden my-2">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-vscode-text-muted border-b border-vscode-border flex items-center justify-between">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={copyCode}
          className="text-vscode-text-muted hover:text-vscode-text"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 text-[12px] leading-relaxed text-vscode-text overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function AgentBubble({ text, streaming }) {
  const chunks = splitCodeBlocks(text || '');

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] min-w-0">
        <div className="pl-0">
          {chunks.length === 0 ? <TextBlock text="" /> : chunks.map((chunk, idx) => (
            chunk.type === 'code'
              ? <CodeBlock key={idx} code={chunk.value} lang={chunk.lang} />
              : <TextBlock key={idx} text={chunk.value} />
          ))}
          {streaming && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-vscode-accent align-middle rounded-sm animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallBubble({ tool, done, input, output }) {
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);

  const summary = summarizeTool(tool, input);
  const inputText = formatToolPayload(input);
  const outputText = formatToolPayload(output);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-xl text-xs text-vscode-text-muted border border-vscode-border bg-vscode-bg overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-start gap-2 px-3 py-2 text-left"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          {!done ? (
            <svg className="w-3.5 h-3.5 shrink-0 animate-spin text-vscode-accent mt-0.5"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.22-8.56" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0 text-green-500 mt-0.5"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-vscode-text">{summary}</div>
            <div className="mt-0.5 text-[11px] text-vscode-text-muted">
              {done ? 'Finished' : 'Running'} • {tool}
            </div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <div className="px-3 pb-3 border-t border-vscode-border/60 bg-vscode-sidebar/40">
            {inputText && <TruncatedPayload text={inputText} label="Input" />}
            {outputText && <TruncatedPayload text={outputText} label="Result" />}
            {!inputText && !outputText && (
              <div className="pt-2 text-[11px] text-vscode-text-muted">No additional details for this step.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const PAYLOAD_PREVIEW_LIMIT = 2000;

function TruncatedPayload({ text, label }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = !expanded && text.length > PAYLOAD_PREVIEW_LIMIT;
  return (
    <div className="pt-2">
      <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-[11px] text-vscode-text-muted leading-relaxed font-mono">
        {truncated ? text.slice(0, PAYLOAD_PREVIEW_LIMIT) + '…' : text}
      </pre>
      {text.length > PAYLOAD_PREVIEW_LIMIT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] text-vscode-accent hover:underline"
          style={{ background: 'none', border: 'none', outline: 'none', padding: 0, cursor: 'pointer' }}
        >
          {expanded ? 'Show less' : `Show ${text.length - PAYLOAD_PREVIEW_LIMIT} more chars`}
        </button>
      )}
    </div>
  );
}

function ReasoningBubble({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', outline: 'none' }}
        className="flex flex-col gap-1 max-w-[85%] cursor-pointer text-left"
      >
        <span className="text-[11px] text-vscode-text-muted flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Thinking {open ? '▲' : '▼'}
        </span>
        {open && (
          <div className="px-3 py-2 rounded-xl text-xs text-vscode-text-muted
                          bg-vscode-sidebar border border-vscode-border
                          whitespace-pre-wrap leading-relaxed">
            {text}
          </div>
        )}
      </button>
    </div>
  );
}

function ThinkingPlaceholderBubble({ text }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] min-w-0 rounded-xl border border-vscode-border bg-vscode-sidebar/30 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-vscode-text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-vscode-accent animate-pulse" />
          <span>{text}</span>
        </div>
      </div>
    </div>
  );
}

function TurnToolTimeline({ tools }) {
  const hasRunning = tools.some((t) => !t.done);
  const [open, setOpen] = useState(hasRunning);

  useEffect(() => {
    if (hasRunning) setOpen(true);
  }, [hasRunning]);

  return (
    <div className="mt-1 rounded-lg border border-vscode-border bg-vscode-bg/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs"
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`w-3 h-3 text-vscode-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-vscode-text-muted">Steps • {tools.length}</span>
        <span className="ml-auto text-[11px] text-vscode-text-muted">{hasRunning ? 'Running' : 'Finished'}</span>
      </button>
      {open && (
        <div className="border-t border-vscode-border">
          {tools.map((tool) => (
            <ToolCallBubble
              key={tool.id || `${tool.tool}-${tool.turnId || 'na'}`}
              tool={tool.tool}
              done={tool.done}
              input={tool.input}
              output={tool.output}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TurnResponseGroup({ messages }) {
  const reasoning = messages.filter((m) => m.role === 'reasoning');
  const tools = messages.filter((m) => m.role === 'tool');
  const agents = messages.filter((m) => m.role === 'agent');
  const errors = messages.filter((m) => m.role === 'error');

  return (
    <div className="flex justify-start">
      <div className="max-w-[96%] sm:max-w-[94%] min-w-0 rounded-xl border border-vscode-border bg-vscode-sidebar/40 p-2 sm:p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">Copilot</div>
        {reasoning.map((msg) => <ReasoningBubble key={msg.id} text={msg.text} />)}
        {tools.length > 0 && <TurnToolTimeline tools={tools} />}
        {agents.map((msg) => <AgentBubble key={msg.id} text={msg.text} streaming={msg.streaming} />)}
        {errors.map((msg) => (
          <div key={msg.id} className="px-3 py-2 rounded-xl text-sm bg-red-900/30 text-red-400 border border-red-900/50 break-words mt-1">
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildRenderItems(messages) {
  const groupedByTurn = new Map();
  for (const msg of messages) {
    if (!msg.turnId) continue;
    if (!groupedByTurn.has(msg.turnId)) groupedByTurn.set(msg.turnId, []);
    groupedByTurn.get(msg.turnId).push(msg);
  }

  const items = [];
  const emittedTurns = new Set();
  const emittedMessageIds = new Set();

  for (const msg of messages) {
    if (emittedMessageIds.has(msg.id)) continue;

    if (msg.role === 'user') {
      items.push({ type: 'user', key: msg.id, message: msg });
      emittedMessageIds.add(msg.id);

      if (msg.turnId && !emittedTurns.has(msg.turnId)) {
        const turnMessages = (groupedByTurn.get(msg.turnId) || []).filter((m) => m.role !== 'user');
        if (turnMessages.length > 0) {
          items.push({ type: 'turn', key: `turn:${msg.turnId}`, messages: turnMessages });
          for (const tm of turnMessages) emittedMessageIds.add(tm.id);
          emittedTurns.add(msg.turnId);
        }
      }
      continue;
    }

    if (msg.turnId && !emittedTurns.has(msg.turnId)) {
      const turnMessages = (groupedByTurn.get(msg.turnId) || []).filter((m) => m.role !== 'user');
      if (turnMessages.length > 0) {
        items.push({ type: 'turn', key: `turn:${msg.turnId}`, messages: turnMessages });
        for (const tm of turnMessages) emittedMessageIds.add(tm.id);
        emittedTurns.add(msg.turnId);
      }
      continue;
    }

    if (!msg.turnId) {
      if (msg.role === 'agent') {
        items.push({ type: 'agent', key: msg.id, message: msg });
      } else if (msg.role === 'reasoning') {
        items.push({ type: 'reasoning', key: msg.id, message: msg });
      } else if (msg.role === 'tool') {
        items.push({ type: 'tool', key: msg.id, message: msg });
      } else if (msg.role === 'error') {
        items.push({ type: 'error', key: msg.id, message: msg });
      }
      emittedMessageIds.add(msg.id);
    }
  }

  return items;
}

export default function Chat() {
  const [messages, setMessages] = useState(() => readInitialMessages());
  const [reasoning, setReasoning] = useState('');
  const [input, setInput] = useState(() => readText(CHAT_INPUT_KEY, ''));
  const [streaming, setStreaming] = useState(false);
  const [changesSummary, setChangesSummary] = useState({ totals: { files: 0, added: 0, removed: 0 }, files: [] });
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesLoading, setChangesLoading] = useState(false);
  const [pendingReviewPaths, setPendingReviewPaths] = useState(readInitialPendingReviewPaths);
  const [reviewActionMsg, setReviewActionMsg] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [lastStreamEventAt, setLastStreamEventAt] = useState(0);
  const [streamClock, setStreamClock] = useState(0);
  const [quietStage, setQuietStage] = useState('thinking');
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const preRequestSnapshotRef = useRef(new Map());
  const shouldAutoScrollRef = useRef(true);
  const activeTurnRef = useRef(null);

  function finalizePendingToolCalls(turnId = null, output = null) {
    setMessages((prev) => prev.map((msg) => {
      if (msg.role === 'tool' && !msg.done && (!turnId || msg.turnId === turnId)) {
        return {
          ...msg,
          done: true,
          output: msg.output ?? output,
        };
      }
      return msg;
    }));
  }

  const fetchChangesSummary = useCallback(async () => {
    setChangesLoading(true);
    try {
      const r = await fetch(apiUrl('/api/git/changes-summary'));
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      const normalized = {
        totals: data?.totals || { files: 0, added: 0, removed: 0 },
        files: Array.isArray(data?.files) ? data.files : [],
      };
      setChangesSummary(normalized);
      return normalized;
    } catch (_) {
      const empty = { totals: { files: 0, added: 0, removed: 0 }, files: [] };
      setChangesSummary(empty);
      return empty;
    } finally {
      setChangesLoading(false);
    }
  }, []);

  function signatureByPath(summary) {
    const map = new Map();
    for (const f of summary.files || []) {
      map.set(f.path, [f.status, f.added || 0, f.removed || 0, f.staged ? 1 : 0, f.unstaged ? 1 : 0, f.untracked ? 1 : 0].join('|'));
    }
    return map;
  }

  async function handleUndoAgentChanges() {
    if (!pendingReviewPaths.length || undoBusy) return;
    setUndoBusy(true);
    setReviewActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/discard-changes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pendingReviewPaths }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setPendingReviewPaths([]);
      setReviewActionMsg(`Undid ${data.reverted || 0} file change(s).`);
      await fetchChangesSummary();
    } catch (e) {
      setReviewActionMsg(e.message);
    } finally {
      setUndoBusy(false);
    }
  }

  function handleKeepAgentChanges() {
    if (!pendingReviewPaths.length) return;
    setPendingReviewPaths([]);
    setReviewActionMsg('Kept latest agent changes.');
  }

  useEffect(() => {
    fetchChangesSummary();
    const timer = setInterval(fetchChangesSummary, 15000);
    return () => clearInterval(timer);
  }, [fetchChangesSummary]);

  // Auto-scroll only when user is near the bottom.
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function handleMessagesScroll(e) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const safeMessages = messages
      .filter((msg) => msg && typeof msg === 'object')
      .map((msg) => {
        if (msg.role === 'tool') {
          return {
            id: msg.id,
            turnId: msg.turnId,
            role: 'tool',
            tool: msg.tool,
            done: msg.done,
            input: msg.input ?? null,
            output: msg.output ?? null,
          };
        }
        return {
          id: msg.id,
          turnId: msg.turnId,
          role: msg.role,
          text: msg.text,
        };
      });
    writeJson(CHAT_MESSAGES_KEY, safeMessages);
  }, [messages]);

  useEffect(() => {
    writeText(CHAT_INPUT_KEY, input);
  }, [input]);

  useEffect(() => {
    writeJson(CHAT_PENDING_REVIEW_KEY, pendingReviewPaths);
  }, [pendingReviewPaths]);

  useEffect(() => {
    setPendingReviewPaths((prev) => {
      if (!prev.length) return prev;
      if (!changesSummary.files.length) return [];
      const changedPaths = new Set(changesSummary.files.map((file) => file.path));
      const next = prev.filter((filePath) => changedPaths.has(filePath));
      return next.length !== prev.length ? next : prev;
    });
  }, [changesSummary.files]);

  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setStreamClock(Date.now()), 250);
    return () => clearInterval(id);
  }, [streaming]);

  async function handleSend(e) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const turnId = createMessageId();
    activeTurnRef.current = turnId;
    setActiveTurnId(turnId);
    setLastStreamEventAt(Date.now());
    setQuietStage('thinking');
    shouldAutoScrollRef.current = true;

    preRequestSnapshotRef.current = signatureByPath(changesSummary);
    setReviewActionMsg('');

    setInput('');
    setReasoning('');
    setStreaming(true);

    // Append user message
    setMessages((prev) => [...prev, { id: createMessageId(), turnId, role: 'user', text: prompt }]);

    // Text bubbles are created on demand as delta events arrive.
    // activeTextBubbleId  — the id of the currently-streaming text bubble (null between segments).
    // firstAgentId        — used to inject reasoning before the first agent bubble.
    let activeTextBubbleId = null;
    let firstAgentId = null;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let reasoningAcc = '';
      let sawServerError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          setLastStreamEventAt(Date.now());

          switch (event.type) {
            case 'reasoning':
              setQuietStage('planning');
              reasoningAcc += event.content;
              setReasoning(reasoningAcc);
              break;

            case 'delta':
              setQuietStage('writing');
              if (!activeTextBubbleId) {
                const newId = createMessageId();
                if (!firstAgentId) firstAgentId = newId;
                activeTextBubbleId = newId;
                setMessages((prev) => [...prev, { id: newId, turnId, role: 'agent', text: event.content, streaming: true }]);
              } else {
                const curId = activeTextBubbleId;
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    next[i] = { ...next[i], text: next[i].text + event.content };
                  }
                  return next;
                });
              }
              break;

            case 'tool_call': {
              setQuietStage('tools');
              // Finalize the current text bubble before showing the tool action
              const curId = activeTextBubbleId;
              if (curId) {
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    if (!next[i].text.trim()) {
                      next.splice(i, 1);
                      if (firstAgentId === curId) firstAgentId = null;
                    } else {
                      next[i] = { ...next[i], streaming: false };
                    }
                  }
                  return next;
                });
                activeTextBubbleId = null;
              }
              setMessages((prev) => [
                ...prev,
                { id: createMessageId(), turnId, role: 'tool', tool: event.tool, input: event.input ?? null, output: null, done: false },
              ]);
              break;
            }

            case 'tool_result':
              setQuietStage('tools');
              setMessages((prev) => {
                const next = [...prev];
                // Prefer exact tool-name match; fallback to last pending tool.
                let matchedIndex = -1;
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === 'tool' && next[i].tool === event.tool && !next[i].done) {
                    matchedIndex = i;
                    break;
                  }
                }
                if (matchedIndex === -1) {
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === 'tool' && !next[i].done) {
                      matchedIndex = i;
                      break;
                    }
                  }
                }
                if (matchedIndex !== -1) {
                  next[matchedIndex] = { ...next[matchedIndex], done: true, output: event.output ?? null };
                }
                return next;
              });
              break;

            case 'message':
              setQuietStage('writing');
              // Finalize the active streaming text bubble with authoritative final content
              if (activeTextBubbleId) {
                const curId = activeTextBubbleId;
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    next[i] = { ...next[i], text: event.content, streaming: false };
                  }
                  return next;
                });
                activeTextBubbleId = null;
              } else if (event.content?.trim()) {
                // No active bubble — message arrived without prior deltas
                const newId = createMessageId();
                if (!firstAgentId) firstAgentId = newId;
                setMessages((prev) => [...prev, { id: newId, turnId, role: 'agent', text: event.content, streaming: false }]);
              }
              break;

            case 'error':
              setQuietStage('thinking');
              sawServerError = true;
              finalizePendingToolCalls(turnId, { error: event.message || 'Tool execution ended with error.' });
              setMessages((prev) => [
                ...prev,
                { id: createMessageId(), turnId, role: 'error', text: event.message },
              ]);
              break;

            case 'done':
              setQuietStage('thinking');
              finalizePendingToolCalls(turnId);
              break;
          }
        }
      }

      // If reasoning was accumulated, inject it just before the first agent bubble
      if (reasoningAcc && firstAgentId) {
        const fId = firstAgentId;
        setMessages((prev) => {
          const next = [...prev];
          const i = next.findIndex((m) => m.id === fId);
          if (i !== -1) next.splice(i, 0, { id: createMessageId(), turnId, role: 'reasoning', text: reasoningAcc });
          return next;
        });
      }

      // Finalise: clean up any remaining streaming agent bubble (safety net)
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'agent' && next[i].streaming && next[i].turnId === turnId) {
            const text = typeof next[i].text === 'string' ? next[i].text.trim() : '';
            if (!text) {
              if (sawServerError) {
                next.splice(i, 1);
              } else {
                next[i] = {
                  id: createMessageId(),
                  turnId,
                  role: 'error',
                  text: 'No response content was returned by the agent. Check backend auth/token setup.',
                };
              }
            } else {
              next[i] = { ...next[i], streaming: false };
            }
            break;
          }
        }
        return next;
      });

    } catch (err) {
      if (err.name !== 'AbortError') {
        finalizePendingToolCalls(turnId, { error: err.message || 'Tool execution ended with error.' });
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === 'agent' && m.text === '' && m.streaming)),
          { id: createMessageId(), turnId, role: 'error', text: err.message },
        ]);
      }
    } finally {
      finalizePendingToolCalls(turnId);
      activeTurnRef.current = null;
      setActiveTurnId(null);
      setStreaming(false);
      abortRef.current = null;
      const nextSummary = await fetchChangesSummary();
      const before = preRequestSnapshotRef.current;
      const after = signatureByPath(nextSummary);
      const touched = [];
      for (const filePath of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(filePath) !== after.get(filePath)) {
          touched.push(filePath);
        }
      }
      if (touched.length > 0) {
        setPendingReviewPaths(touched);
      }
    }
  }

  function handleAbort() {
    const turnId = activeTurnRef.current;
    abortRef.current?.abort();
    finalizePendingToolCalls(turnId, { cancelled: true });
    setActiveTurnId(null);
    setStreaming(false);
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const msg = next[i];
        if (msg?.role === 'agent' && msg.streaming && (!turnId || msg.turnId === turnId)) {
          next[i] = {
            ...msg,
            streaming: false,
            text: msg.text ? msg.text + '\n\n_(aborted)_' : '',
          };
          if (!next[i].text) {
            next.splice(i, 1);
          }
          break;
        }
      }
      return next;
    });
  }

  async function handleCopyReviewSummary() {
    const files = displayFiles.length ? displayFiles : changesSummary.files;
    const header = `Files changed: ${changesSummary.totals.files} +${changesSummary.totals.added} -${changesSummary.totals.removed}`;
    const lines = files.slice(0, 100).map((file) => `${file.path} (+${file.added || 0} -${file.removed || 0})`);
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setReviewActionMsg('Copied change summary.');
    } catch (_) {
      setReviewActionMsg('Could not copy summary.');
    }
  }

  const reviewFileSet = new Set(pendingReviewPaths);
  const displayFiles = reviewFileSet.size
    ? changesSummary.files.filter((file) => reviewFileSet.has(file.path))
    : changesSummary.files;
  const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
  const activeTurnMessages = useMemo(
    () => (activeTurnId ? messages.filter((m) => m.turnId === activeTurnId) : []),
    [messages, activeTurnId]
  );
  const hasVisibleProgressCue = activeTurnMessages.some((m) =>
    (m.role === 'tool' && !m.done)
    || (m.role === 'agent' && m.streaming && typeof m.text === 'string' && m.text.trim().length > 0)
  );
  const showThinkingPlaceholder = streaming
    && Boolean(activeTurnId)
    && !hasVisibleProgressCue
    && (streamClock - lastStreamEventAt > 1200);
  const thinkingLabel = quietStage === 'planning'
    ? 'Planning...'
    : quietStage === 'tools'
      ? 'Running tools...'
      : quietStage === 'writing'
        ? 'Writing response...'
        : 'Thinking...';

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div ref={scrollRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3">
        {renderItems.map((item) => {
          if (item.type === 'user') return <UserBubble key={item.key} text={item.message.text} />;
          if (item.type === 'turn') return <TurnResponseGroup key={item.key} messages={item.messages} />;
          if (item.type === 'agent') return <AgentBubble key={item.key} text={item.message.text} streaming={item.message.streaming} />;
          if (item.type === 'reasoning') return <ReasoningBubble key={item.key} text={item.message.text} />;
          if (item.type === 'tool') return <ToolCallBubble key={item.key} tool={item.message.tool} done={item.message.done} input={item.message.input} output={item.message.output} />;
          if (item.type === 'error') return (
            <div key={item.key} className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl text-sm bg-red-900/30 text-red-400 border border-red-900/50 max-w-[85%] break-words">
                {item.message.text}
              </div>
            </div>
          );
          return null;
        })}
        {showThinkingPlaceholder && <ThinkingPlaceholderBubble text={thinkingLabel} />}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="border-t border-vscode-border px-2.5 sm:px-3 py-2"
        style={{ backgroundColor: 'var(--color-vscode-nav)' }}
      >
        <div className="rounded-xl border border-vscode-border overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-vscode-border">
            <button
              type="button"
              onClick={() => setChangesOpen((v) => !v)}
              className="flex items-center gap-2 text-xs text-vscode-text-muted hover:text-vscode-text cursor-pointer"
              style={{ background: 'none', border: 'none', outline: 'none' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className={`w-3 h-3 transition-transform ${changesOpen ? 'rotate-90' : ''}`}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>
                {changesSummary.totals.files} file changed
                <span className="ml-2 text-green-400">+{changesSummary.totals.added}</span>
                <span className="ml-1 text-red-400">-{changesSummary.totals.removed}</span>
              </span>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleKeepAgentChanges}
                disabled={!pendingReviewPaths.length || streaming}
                className="h-8 px-3 rounded-lg border border-vscode-border text-sm text-vscode-text-muted hover:text-vscode-text disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'transparent', outline: 'none' }}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleUndoAgentChanges}
                disabled={!pendingReviewPaths.length || streaming || undoBusy}
                className="h-8 px-3 rounded-lg border border-vscode-border text-sm text-vscode-text-muted hover:text-vscode-text disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'transparent', outline: 'none' }}
              >
                {undoBusy ? 'Undoing…' : 'Undo'}
              </button>
              <button
                type="button"
                onClick={handleCopyReviewSummary}
                className="h-8 w-8 rounded-lg border border-vscode-border text-vscode-text-muted hover:text-vscode-text"
                style={{ background: 'transparent', outline: 'none' }}
                title="Copy change summary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mx-auto" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                type={streaming ? 'button' : 'submit'}
                onClick={streaming ? handleAbort : undefined}
                disabled={!streaming && !input.trim()}
                className="relative h-8 w-8 rounded-lg border border-vscode-border text-vscode-text-muted hover:text-vscode-text disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'transparent', outline: 'none' }}
                title={streaming ? 'Stop' : 'Send'}
              >
                {streaming ? (
                  <>
                    <span className="inline-block w-3 h-3 rounded-sm bg-current" />
                    <span className="absolute inset-0 m-auto w-6 h-6 rounded-full border-2 border-vscode-border/70 border-t-vscode-text animate-spin pointer-events-none" />
                  </>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mx-auto" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Describe what to build"
            disabled={streaming}
            rows={1}
            className="w-full resize-none bg-transparent text-vscode-text placeholder-vscode-text-muted px-3 py-3 outline-none text-sm min-h-[54px] max-h-[140px] overflow-y-auto disabled:opacity-50 leading-relaxed"
            style={{ fieldSizing: 'content' }}
          />

          {reviewActionMsg && (
            <p className="px-3 pb-2 text-[11px] text-vscode-text-muted">{reviewActionMsg}</p>
          )}

          {changesOpen && (
            <div className="mx-2.5 mb-2 max-h-32 overflow-y-auto rounded border border-vscode-border bg-vscode-bg">
              <div className="px-2.5 py-1 border-b border-vscode-border flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-vscode-text-muted">Changed files</span>
                <button
                  type="button"
                  onClick={fetchChangesSummary}
                  disabled={changesLoading}
                  className="text-[10px] text-vscode-text-muted hover:text-vscode-text disabled:opacity-40"
                  style={{ background: 'none', border: 'none', outline: 'none' }}
                >
                  {changesLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {displayFiles.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-vscode-text-muted">No local changes.</p>
              ) : (
                displayFiles.map((file) => (
                  <div key={file.path} className="px-2.5 py-1.5 text-xs border-b border-vscode-border last:border-b-0 flex items-center gap-2">
                    <span className="text-vscode-text truncate flex-1">{file.path}</span>
                    <span className="text-green-400">+{file.added || 0}</span>
                    <span className="text-red-400">-{file.removed || 0}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
