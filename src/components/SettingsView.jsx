import { useState, useEffect } from 'react';
import { apiUrl } from '../config/server';
import { readText, writeText } from '../utils/persist';

const CHAT_UI_AGENT_KEY = 'pocketide.chat.ui.agent.v1';
const CHAT_UI_MODEL_KEY = 'pocketide.chat.ui.model.v1';
const CHAT_UI_EXEC_MODE_KEY = 'pocketide.chat.ui.execMode.v1';
const CHAT_UI_APPROVAL_KEY = 'pocketide.chat.ui.approval.v1';

export default function SettingsView({ onClearCache, onWorkspaceChanged }) {
  const [workspacePath, setWorkspacePath] = useState(null);
  const [changing, setChanging] = useState(false);
  const [inputPath, setInputPath] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [chatAgentLabel, setChatAgentLabel] = useState(() => readText(CHAT_UI_AGENT_KEY, 'Agent'));
  const [chatModelLabel, setChatModelLabel] = useState(() => readText(CHAT_UI_MODEL_KEY, 'Auto'));
  const [chatExecModeLabel, setChatExecModeLabel] = useState(() => readText(CHAT_UI_EXEC_MODE_KEY, 'Local'));
  const [chatApprovalLabel, setChatApprovalLabel] = useState(() => readText(CHAT_UI_APPROVAL_KEY, 'Default Approvals'));

  useEffect(() => {
    fetch(apiUrl('/api/workspace'))
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load workspace path');
        return r.json();
      })
      .then((d) => setWorkspacePath(d.path))
      .catch(() => setWorkspacePath('(unavailable)'));
  }, []);

  function handleChangeClick() {
    setInputPath(workspacePath ?? '');
    setError('');
    setSuggestions([]);
    setChanging(true);
  }

  async function handleConfirmChange() {
    setError('');
    try {
      const res = await fetch(apiUrl('/api/workspace'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: inputPath.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Failed to change workspace (${res.status})`);
        return;
      }
      setWorkspacePath(data.path);
      setSuggestions([]);
      if (typeof onWorkspaceChanged === 'function') {
        await onWorkspaceChanged(data.path);
      }
      setChanging(false);
    } catch (e) {
      setError('Could not reach server');
    }
  }

  useEffect(() => {
    if (!changing) {
      setSuggestions([]);
      return;
    }

    const prefix = inputPath.trim();
    if (!prefix) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(apiUrl(`/api/workspace/suggestions?prefix=${encodeURIComponent(prefix)}`));
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json().catch(() => ({ suggestions: [] }));
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch (_) {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [changing, inputPath]);

  useEffect(() => { writeText(CHAT_UI_AGENT_KEY, chatAgentLabel); }, [chatAgentLabel]);
  useEffect(() => { writeText(CHAT_UI_MODEL_KEY, chatModelLabel); }, [chatModelLabel]);
  useEffect(() => { writeText(CHAT_UI_EXEC_MODE_KEY, chatExecModeLabel); }, [chatExecModeLabel]);
  useEffect(() => { writeText(CHAT_UI_APPROVAL_KEY, chatApprovalLabel); }, [chatApprovalLabel]);

  function handlePickSuggestion(nextPath) {
    setInputPath(nextPath);
    setSuggestions([]);
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <h1 className="text-base font-semibold text-vscode-text mb-6">Settings</h1>

      {/* Workspace section */}
      <div className="mb-2">
        <p className="text-[11px] uppercase tracking-widest text-vscode-text-muted mb-3 px-1">
          Workspace
        </p>
        <div
          className="rounded-xl border border-vscode-border overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          {/* Current Workspace row */}
          <div className="px-4 py-3 border-b border-vscode-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-vscode-text font-medium">Current Workspace</p>
                <p
                  className="text-xs text-vscode-text-muted mt-0.5 break-all"
                  title={workspacePath ?? ''}
                >
                  {workspacePath ?? 'Loading…'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleChangeClick}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer"
                style={{ background: 'transparent' }}
              >
                Change
              </button>
            </div>

            {changing && (
              <div className="mt-3">
                <input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmChange();
                    if (e.key === 'Escape') setChanging(false);
                  }}
                  placeholder="/absolute/path/to/folder"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent focus:outline-none focus:border-vscode-accent"
                  autoFocus
                />
                {(loadingSuggestions || suggestions.length > 0) && (
                  <div
                    className="mt-1 rounded-lg border border-vscode-border overflow-hidden"
                    style={{ backgroundColor: 'rgba(20,20,22,0.98)' }}
                  >
                    {loadingSuggestions && (
                      <p className="px-3 py-2 text-xs text-vscode-text-muted">Loading directories...</p>
                    )}
                    {!loadingSuggestions && suggestions.map((dirPath) => (
                      <button
                        key={dirPath}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handlePickSuggestion(dirPath)}
                        className="w-full text-left px-3 py-2 text-xs text-vscode-text hover:bg-vscode-sidebar-hover border-none cursor-pointer"
                        style={{ background: 'transparent' }}
                      >
                        {dirPath}
                      </button>
                    ))}
                  </div>
                )}
                {error && (
                  <p className="text-xs text-red-400 mt-1">{error}</p>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleConfirmChange}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-vscode-accent text-white border-none cursor-pointer"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setChanging(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer"
                    style={{ background: 'transparent' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Clear Cache row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm text-vscode-text font-medium">Clear Cache</p>
              <p className="text-xs text-vscode-text-muted mt-0.5">Clears current workspace</p>
            </div>
            <button
              type="button"
              onClick={onClearCache}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer"
              style={{ background: 'transparent' }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* AI Chat Controls section */}
      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-widest text-vscode-text-muted mb-3 px-1">
          AI Chat Controls
        </p>
        <div className="rounded-xl border border-vscode-border overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Top Bar Mode</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Controls what label appears in the first control row.</p>
            <select
              value={chatAgentLabel}
              onChange={(e) => setChatAgentLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Agent">Agent</option>
              <option value="Chat">Chat</option>
              <option value="Assist">Assist</option>
            </select>
          </div>

          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Model Selector Label</p>
            <select
              value={chatModelLabel}
              onChange={(e) => setChatModelLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Auto">Auto</option>
              <option value="Balanced">Balanced</option>
              <option value="Fast">Fast</option>
              <option value="Quality">Quality</option>
            </select>
          </div>

          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Execution Mode Label</p>
            <select
              value={chatExecModeLabel}
              onChange={(e) => setChatExecModeLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Local">Local</option>
              <option value="Copilot CLI">Copilot CLI</option>
              <option value="Cloud">Cloud</option>
            </select>
          </div>

          <div className="px-4 py-3">
            <p className="text-sm text-vscode-text font-medium">Approval Policy Label</p>
            <select
              value={chatApprovalLabel}
              onChange={(e) => setChatApprovalLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Default Approvals">Default Approvals</option>
              <option value="Ask Every Time">Ask Every Time</option>
              <option value="Auto Approve Safe">Auto Approve Safe</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
