import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  Folder,
  Globe2,
  History,
  Info,
  Layers3,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  WrapText,
  X,
  Zap,
} from 'lucide-react';
import KeyValueEditor from './components/KeyValueEditor';
import CodeViewer from './components/CodeViewer';
import Modal from './components/Modal';
import {
  buildUrl,
  environmentValues,
  formatBytes,
  initialWorkspace,
  makeRequest,
  prettyBody,
  row,
  sanitizeWorkspace,
  splitUrlQuery,
  uid,
} from './lib/model';
import {
  cancelRequest,
  downloadText,
  executeRequest,
  exportCurl,
  importCurl,
  isDesktop,
  loadWorkspace,
  saveWorkspace,
} from './lib/bridge';
import type { Auth, Environment, HttpRequest, RequestTab, Workspace } from './lib/types';

type Dialog =
  | 'import'
  | 'save'
  | 'environments'
  | 'settings'
  | 'requestSettings'
  | 'ai'
  | 'curl'
  | 'folder'
  | 'delete'
  | 'workspaceExport'
  | 'discard'
  | 'deleteEnvironment'
  | null;
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const draft = initialWorkspace();
const getError = (error: unknown) => (error instanceof Error ? error.message : String(error));
function Method({ method }: { method: string }) {
  return <span className={`method-badge method-${method.toLowerCase()}`}>{method}</span>;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(draft);
  const [tabs, setTabs] = useState<RequestTab[]>([{ request: structuredClone(draft.saved[0]) }]);
  const [activeId, setActiveId] = useState(draft.saved[0].id);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestView, setRequestView] = useState('Params');
  const [responseView, setResponseView] = useState('Body');
  const [sidebar, setSidebar] = useState(true);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [openFolders, setOpenFolders] = useState<string[]>(['User API', 'Projects', 'Auth']);
  const [showSaved, setShowSaved] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const running = useRef(new Map<string, string>());
  const [dialog, setDialog] = useState<Dialog>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const importGeneration = useRef(0);
  const [toast, setToast] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [curlText, setCurlText] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveFolder, setSaveFolder] = useState('');
  const [folderName, setFolderName] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [closingId, setClosingId] = useState('');
  const [envEditId, setEnvEditId] = useState('development');
  const [pretty, setPretty] = useState(true);
  const [responseFormat, setResponseFormat] = useState<'auto' | 'json' | 'text'>('auto');
  const [wrap, setWrap] = useState(false);
  const [responseSearch, setResponseSearch] = useState('');
  const [showResponseSearch, setShowResponseSearch] = useState(false);
  const [urlPreview, setUrlPreview] = useState(false);
  const [menu, setMenu] = useState<
    'workspace' | 'send' | 'parameters' | 'response' | 'responseOptions' | null
  >(null);
  const [responseExpanded, setResponseExpanded] = useState(false);
  const [split, setSplit] = useState(43);
  const panelRef = useRef<HTMLDivElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const active = tabs.find((t) => t.request.id === activeId) ?? tabs[0];
  const request = active.request;
  const response = active.response;
  const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  const env = environmentValues(environment);
  const loading = pending.includes(request.id);
  const saved = workspace.saved.find((r) => r.id === request.id);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(request);
  const notify = useCallback((message: string) => setToast(message), []);
  const changeRequest = useCallback(
    (patch: Partial<HttpRequest>) =>
      setTabs((old) =>
        old.map((t) =>
          t.request.id === activeId ? { ...t, request: { ...t.request, ...patch } } : t,
        ),
      ),
    [activeId],
  );
  const changeTab = (id: string, patch: Partial<RequestTab>) =>
    setTabs((old) => old.map((t) => (t.request.id === id ? { ...t, ...patch } : t)));
  useEffect(() => {
    let live = true;
    loadWorkspace()
      .then((loaded) => {
        if (!live) return;
        if (loaded) {
          setWorkspace(loaded);
          const first = loaded.saved[0] ?? makeRequest();
          setTabs([{ request: structuredClone(first) }]);
          setActiveId(first.id);
          setEnvEditId(loaded.activeEnvironmentId);
        }
        setReady(true);
      })
      .catch((e) => {
        if (live) {
          setLoadFailed(true);
          notify(
            `Your workspace could not be loaded: ${getError(e)}. Local saving is paused to preserve your data.`,
          );
        }
      });
    return () => {
      live = false;
    };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      saveWorkspace(workspace).catch((e) => notify(`Could not save locally: ${getError(e)}`));
    }, 400);
    return () => clearTimeout(timer);
  }, [workspace, ready, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setDialogError('');
    setMenu(null);
    if (dialog !== 'import') {
      importGeneration.current++;
      setImportBusy(false);
    }
  }, [dialog]);
  const newRequest = useCallback(() => {
    const item = makeRequest();
    setTabs((old) => [...old, { request: item }]);
    setActiveId(item.id);
    setRequestView('Params');
    setResponseExpanded(false);
  }, []);
  const openRequest = (item: HttpRequest, history = false) => {
    const next = structuredClone(item);
    if (history) next.id = uid();
    if (!tabs.some((t) => t.request.id === next.id)) setTabs((old) => [...old, { request: next }]);
    setActiveId(next.id);
    setResponseExpanded(false);
    setMenu(null);
  };
  const closeTab = (id: string, discard = false) => {
    const target = tabs.find((t) => t.request.id === id)?.request;
    const original = workspace.saved.find((r) => r.id === id);
    if (
      !discard &&
      target &&
      JSON.stringify(target) !== JSON.stringify(original) &&
      (target.url || target.body || target.headers.length || target.query.length)
    ) {
      setClosingId(id);
      setDialog('discard');
      return;
    }
    if (running.current.has(id)) {
      notify('Cancel this request before closing its tab.');
      return;
    }
    const next = tabs.filter((t) => t.request.id !== id);
    if (!next.length) {
      const item = makeRequest();
      setTabs([{ request: item }]);
      setActiveId(item.id);
    } else {
      setTabs(next);
      if (activeId === id)
        setActiveId(next[Math.max(0, tabs.findIndex((t) => t.request.id === id) - 1)].request.id);
    }
  };
  const openSave = useCallback(() => {
    setSaveName(request.name === 'Untitled request' ? '' : request.name);
    setSaveFolder(request.folder ?? workspace.folders[0] ?? '');
    setDialog('save');
  }, [request, workspace.folders]);
  const send = useCallback(async () => {
    if (running.current.has(request.id)) return;
    if (!request.url.trim()) {
      notify('Enter a URL to send your request.');
      return;
    }
    const snapshot = structuredClone(request);
    const token = uid();
    running.current.set(snapshot.id, token);
    setPending((old) => [...old, snapshot.id]);
    changeTab(snapshot.id, { error: undefined });
    try {
      const result = await executeRequest(snapshot, env);
      if (running.current.get(snapshot.id) !== token) return;
      changeTab(snapshot.id, { response: result, error: undefined });
      setWorkspace((w) => ({
        ...w,
        history: [
          {
            id: uid(),
            request: snapshot,
            createdAt: new Date().toISOString(),
            status: result.status,
            durationMs: result.durationMs,
          },
          ...w.history,
        ].slice(0, 100),
      }));
    } catch (e) {
      if (running.current.get(snapshot.id) !== token) return;
      const error = getError(e);
      changeTab(snapshot.id, { error, response: undefined });
      setWorkspace((w) => ({
        ...w,
        history: [
          { id: uid(), request: snapshot, createdAt: new Date().toISOString(), error },
          ...w.history,
        ].slice(0, 100),
      }));
    } finally {
      if (running.current.get(snapshot.id) === token) {
        running.current.delete(snapshot.id);
        setPending((old) => old.filter((id) => id !== snapshot.id));
      }
    }
  }, [request, env, notify]);
  const stop = async () => {
    try {
      await cancelRequest(request.id);
    } catch (e) {
      notify(getError(e));
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'k') {
        e.preventDefault();
        setSidebar(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (dialog) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void send();
      }
      if (e.key === 's') {
        e.preventDefault();
        openSave();
      }
      if (e.key === 't') {
        e.preventDefault();
        newRequest();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [send, openSave, newRequest, dialog]);
  const copy = async (text: string, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      notify(label);
    } catch {
      notify('Clipboard access is unavailable. Select the text and copy it manually.');
    }
  };
  const save = async () => {
    if (saveBusy) return;
    if (!saveName.trim()) {
      setDialogError('Give this request a name.');
      return;
    }
    const updated = { ...request, name: saveName.trim(), folder: saveFolder };
    const next = {
      ...workspace,
      saved: workspace.saved.some((r) => r.id === updated.id)
        ? workspace.saved.map((r) => (r.id === updated.id ? updated : r))
        : [...workspace.saved, updated],
    };
    setSaveBusy(true);
    try {
      if (!loadFailed) await saveWorkspace(next);
      changeRequest(updated);
      setWorkspace((w) => ({
        ...w,
        saved: w.saved.some((r) => r.id === updated.id)
          ? w.saved.map((r) => (r.id === updated.id ? updated : r))
          : [...w.saved, updated],
      }));
      setOpenFolders((old) => (old.includes(saveFolder) ? old : [...old, saveFolder]));
      if (dialogRef.current === 'save') setDialog(null);
      notify(
        loadFailed
          ? 'Request kept in this session. Local saving is paused to protect your existing workspace.'
          : 'Request saved locally. Credentials stay in this session.',
      );
    } catch (e) {
      if (dialogRef.current === 'save')
        setDialogError(`Could not save this request: ${getError(e)}`);
      else notify(`Could not save this request: ${getError(e)}`);
    } finally {
      setSaveBusy(false);
    }
  };
  const doImport = async () => {
    if (importBusy) return;
    const generation = ++importGeneration.current;
    setDialogError('');
    setImportBusy(true);
    try {
      const imported = await importCurl(curlText);
      if (generation !== importGeneration.current || dialogRef.current !== 'import') return;
      const item = { ...imported, id: uid() };
      setTabs((old) => [...old, { request: item }]);
      setActiveId(item.id);
      setRequestView(item.bodyType === 'none' ? 'Params' : 'Body');
      setDialog(null);
      setCurlText('');
      notify('cURL imported. Review the request before sending.');
    } catch (e) {
      if (generation === importGeneration.current && dialogRef.current === 'import')
        setDialogError(getError(e));
    } finally {
      if (generation === importGeneration.current) setImportBusy(false);
    }
  };
  const exportWorkspace = () => {
    setCurlText(JSON.stringify(sanitizeWorkspace(workspace), null, 2));
    setDialog('workspaceExport');
  };
  const doExport = async () => {
    setMenu(null);
    try {
      setCurlText(await exportCurl(request, env));
      setDialog('curl');
    } catch (e) {
      notify(getError(e));
    }
  };
  const updateEnvironment = (id: string, patch: Partial<Environment>) =>
    setWorkspace((w) => ({
      ...w,
      environments: w.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  const editEnvironment =
    workspace.environments.find((e) => e.id === envEditId) ?? workspace.environments[0];
  const filtered = workspace.saved.filter((r) =>
    `${r.name} ${r.method} ${r.url}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredHistory = workspace.history.filter((h) =>
    `${h.request.name} ${h.request.method} ${h.request.url}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const preview = (() => {
    try {
      return buildUrl(request, env);
    } catch (e) {
      return getError(e);
    }
  })();
  const updateAuth = (patch: Partial<Auth>) =>
    changeRequest({ auth: { ...request.auth, ...patch } });
  const prettyResponse = response ? (pretty ? prettyBody(response.body) : response.body) : '';
  const jsonResponse =
    responseFormat === 'json' ||
    (responseFormat === 'auto' && (response?.contentType.includes('json') ?? false));
  const handleUrlBlur = () => {
    if (request.url.includes('?')) {
      const split = splitUrlQuery(request.url);
      changeRequest({ url: split.url, query: [...request.query, ...split.query] });
    }
  };
  const statusGood = response && response.status >= 200 && response.status < 300;
  const resizePanels = (event: React.PointerEvent) => {
    if (responseExpanded) return;
    event.preventDefault();
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const move = (e: PointerEvent) =>
      setSplit(Math.min(70, Math.max(25, ((e.clientY - bounds.top) / bounds.height) * 100)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  return (
    <div className="app-shell">
      {!ready && !loadFailed && (
        <div className="workspace-loading" role="status">
          <Loader2 className="spin" size={24} />
          <span>Opening your local workspace…</span>
        </div>
      )}
      <header className="app-titlebar" data-tauri-drag-region>
        <div className="brand">
          <span className="brand-icon">
            R<span>↗</span>
          </span>
          <strong>Req</strong>
          <span className="brand-divider" />
          <span className="app-subtitle">
            API Testing Client <span className="local-first">(Local-First)</span>
          </span>
        </div>
        <div className="titlebar-actions">
          <span className="local-indicator">
            <span />
            Local workspace
          </span>
          <button
            className="icon-button"
            title="Environments"
            aria-label="Manage environments"
            onClick={() => setDialog('environments')}
          >
            <Layers3 size={18} />
          </button>
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setDialog('settings')}
          >
            <Settings2 size={18} />
          </button>
          <span className="small-divider" />
          <button
            className="icon-button"
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeft size={18} />
          </button>
        </div>
      </header>
      <div className="workspace-layout">
        {sidebar && (
          <aside className="sidebar">
            <div className="search-box">
              <Search size={17} />
              <input
                ref={searchRef}
                aria-label="Search requests"
                placeholder="Search requests..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>⌘K</kbd>
              )}
            </div>
            <nav className="sidebar-nav" aria-label="Requests">
              <button className="nav-heading" onClick={() => setShowHistory(!showHistory)}>
                <History size={19} />
                <span>History</span>
                {workspace.history.length > 0 && (
                  <span className="nav-count">{workspace.history.length}</span>
                )}
                {showHistory ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {(showHistory || search) && (
                <div className="history-list">
                  {!filteredHistory.length ? (
                    <p className="sidebar-empty">
                      {search ? 'No matching history.' : 'Your sent requests appear here.'}
                    </p>
                  ) : (
                    filteredHistory.slice(0, 30).map((h) => (
                      <button
                        className="history-item"
                        key={h.id}
                        title={`${h.request.method} ${h.request.url}\n${new Date(h.createdAt).toLocaleString()}`}
                        onClick={() => openRequest(h.request, true)}
                      >
                        <Method method={h.request.method} />
                        <span>
                          {h.request.name === 'Untitled request' ? h.request.url : h.request.name}
                        </span>
                        <small className={h.error ? 'error-text' : ''}>{h.status ?? 'ERR'}</small>
                      </button>
                    ))
                  )}
                </div>
              )}
              <div className="nav-heading-wrap">
                <button className="nav-heading" onClick={() => setShowSaved(!showSaved)}>
                  <Bookmark size={18} />
                  <span>Saved Requests</span>
                  {showSaved ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <button
                  className="icon-button folder-add"
                  title="New folder"
                  aria-label="New folder"
                  onClick={() => {
                    setFolderName('');
                    setDialog('folder');
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
              {(showSaved || search) && (
                <div className="saved-tree">
                  {workspace.folders.map((folder) => {
                    const items = filtered.filter((r) => r.folder === folder);
                    const expanded = openFolders.includes(folder) || !!search;
                    if (search && !items.length) return null;
                    return (
                      <div className="folder-group" key={folder}>
                        <button
                          className="folder-heading"
                          onClick={() =>
                            setOpenFolders((old) =>
                              old.includes(folder)
                                ? old.filter((x) => x !== folder)
                                : [...old, folder],
                            )
                          }
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <Folder size={18} />
                          <span>{folder}</span>
                          <small>{items.length || ''}</small>
                        </button>
                        {expanded && (
                          <div className="folder-items">
                            {items.length ? (
                              items.map((item) => (
                                <div
                                  className={`request-item ${request.id === item.id ? 'selected' : ''}`}
                                  key={item.id}
                                >
                                  <button
                                    aria-label={`${item.method} ${item.name}`}
                                    onClick={() => openRequest(item)}
                                    title={item.url}
                                  >
                                    <Method method={item.method} />
                                    <span>{item.name}</span>
                                  </button>
                                  <button
                                    className="request-delete icon-button"
                                    title="Delete saved request"
                                    aria-label={`Delete ${item.name}`}
                                    onClick={() => {
                                      setDeleteId(item.id);
                                      setDialog('delete');
                                    }}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <p className="folder-empty">No requests yet</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filtered
                    .filter((r) => !r.folder || !workspace.folders.includes(r.folder))
                    .map((item) => (
                      <div
                        className={`request-item unfiled ${request.id === item.id ? 'selected' : ''}`}
                        key={item.id}
                      >
                        <button
                          aria-label={`${item.method} ${item.name}`}
                          onClick={() => openRequest(item)}
                        >
                          <Method method={item.method} />
                          <span>{item.name}</span>
                        </button>
                      </div>
                    ))}
                  {search && !filtered.length && (
                    <p className="sidebar-empty">No saved requests found.</p>
                  )}
                </div>
              )}
            </nav>
            <div className="sidebar-footer">
              <div className="sidebar-note">
                <ShieldCheck size={13} />
                <span>On your machine. In your control.</span>
              </div>
              <div className="new-request-row">
                <button className="button new-request" onClick={newRequest}>
                  <Plus size={18} />
                  <span>New Request</span>
                </button>
                <div className="menu-anchor">
                  <button
                    className="button icon-only"
                    aria-label="Workspace actions"
                    onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                  {menu === 'workspace' && (
                    <>
                      <div className="menu-dismiss" onClick={() => setMenu(null)} />
                      <div className="dropdown-menu bottom">
                        <button
                          onClick={() => {
                            setCurlText('');
                            setDialog('import');
                          }}
                        >
                          <Terminal size={15} />
                          Import cURL
                        </button>
                        <button
                          onClick={() => {
                            exportWorkspace();
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          Export workspace
                        </button>
                        <button onClick={() => setDialog('settings')}>
                          <Settings2 size={15} />
                          Settings
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
        <main className="main-panel">
          <div className="tabbar">
            <div className="request-tabs" role="tablist" aria-label="Open requests">
              {tabs.map((t) => (
                <div
                  className={`request-tab ${t.request.id === activeId ? 'active' : ''}`}
                  key={t.request.id}
                >
                  <button
                    role="tab"
                    aria-label={`${t.request.method} ${t.request.name}`}
                    aria-selected={t.request.id === activeId}
                    onClick={() => {
                      setActiveId(t.request.id);
                      setResponseExpanded(false);
                    }}
                  >
                    <Method method={t.request.method} />
                    <span>{t.request.name}</span>
                    {!workspace.saved.some(
                      (s) =>
                        s.id === t.request.id && JSON.stringify(s) === JSON.stringify(t.request),
                    ) && <i className="dirty-dot" title="Unsaved changes" />}
                  </button>
                  <button
                    className="icon-button close-tab"
                    aria-label={`Close ${t.request.name}`}
                    onClick={() => closeTab(t.request.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                className="icon-button new-tab"
                title="New request (⌘T)"
                aria-label="New request tab"
                onClick={newRequest}
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="environment-picker">
              <button
                className="env-label"
                onClick={() => {
                  setEnvEditId(workspace.activeEnvironmentId);
                  setDialog('environments');
                }}
              >
                <Layers3 size={17} />
                <span>Environment</span>
              </button>
              <select
                aria-label="Active environment"
                value={workspace.activeEnvironmentId}
                onChange={(e) =>
                  setWorkspace((w) => ({ ...w, activeEnvironmentId: e.target.value }))
                }
              >
                <option value="">No environment</option>
                {workspace.environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            ref={panelRef}
            className={`request-response ${responseExpanded ? 'response-expanded' : ''}`}
          >
            {!responseExpanded && (
              <section
                className="request-panel"
                style={{ height: `${split}%` }}
                aria-label="Request editor"
              >
                <div className="url-row">
                  <select
                    className="method-select"
                    aria-label="HTTP method"
                    value={request.method}
                    onChange={(e) => changeRequest({ method: e.target.value })}
                  >
                    {[...new Set([...methods, request.method])].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <div className="url-input-wrap">
                    <input
                      aria-label="Request URL"
                      className="url-input"
                      placeholder="https://api.example.com/v1/users"
                      value={request.url}
                      spellCheck={false}
                      onBlur={handleUrlBlur}
                      onChange={(e) => changeRequest({ url: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) void send();
                      }}
                    />
                    <button
                      className="button icon-only request-options"
                      title="Request options"
                      aria-label="Request options"
                      onClick={() => setDialog('requestSettings')}
                    >
                      <SlidersHorizontal size={20} />
                    </button>
                  </div>
                  <div className="send-group">
                    <button
                      className={`send-button ${loading ? 'loading' : ''}`}
                      onClick={() => (loading ? void stop() : void send())}
                    >
                      {loading ? <Square size={13} fill="currentColor" /> : <Play size={19} />}
                      {loading ? 'Cancel' : 'Send'}
                    </button>
                    <button
                      className="send-chevron"
                      aria-label="Send options"
                      onClick={() => setMenu(menu === 'send' ? null : 'send')}
                    >
                      <ChevronDown size={15} />
                    </button>
                    {menu === 'send' && (
                      <>
                        <div className="menu-dismiss" onClick={() => setMenu(null)} />
                        <div className="dropdown-menu send-menu">
                          <button onClick={() => void doExport()}>
                            <Terminal size={15} />
                            Export as cURL
                          </button>
                          <button
                            onClick={() => {
                              setCurlText('');
                              setDialog('import');
                            }}
                          >
                            <Code2 size={15} />
                            Import cURL
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    className="button ai-button"
                    title="AI assistance"
                    aria-label="AI assistance"
                    onClick={() => setDialog('ai')}
                  >
                    <Sparkles size={19} />
                  </button>
                </div>
                <div className="editor-tabs">
                  <div className="section-tabs" role="tablist" aria-label="Request sections">
                    {['Params', 'Headers', 'Body', 'Auth'].map((name) => (
                      <button
                        role="tab"
                        aria-selected={requestView === name}
                        className={requestView === name ? 'active' : ''}
                        onClick={() => setRequestView(name)}
                        key={name}
                      >
                        {name}
                        {name === 'Params' &&
                          request.query.filter((x) => x.enabled && x.key).length > 0 && (
                            <span className="count-badge">
                              {request.query.filter((x) => x.enabled && x.key).length}
                            </span>
                          )}
                        {name === 'Headers' &&
                          request.headers.filter((x) => x.enabled && x.key).length > 0 && (
                            <span className="count-badge">
                              {request.headers.filter((x) => x.enabled && x.key).length}
                            </span>
                          )}
                        {name === 'Body' && request.bodyType !== 'none' && (
                          <span className="tab-dot" />
                        )}
                        {name === 'Auth' && request.auth.type !== 'none' && (
                          <span className="tab-dot" />
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    className="save-request-button"
                    title="Save request (⌘S)"
                    onClick={openSave}
                  >
                    <Save size={14} />
                    <span>{dirty ? 'Save request' : 'Saved'}</span>
                  </button>
                </div>
                <div className="request-content">
                  {requestView === 'Params' && (
                    <>
                      <div className="section-heading">
                        <h2>Query Parameters</h2>
                        <div className="section-heading-actions">
                          <button
                            className={`button small ${urlPreview ? 'pressed' : ''}`}
                            onClick={() => setUrlPreview(!urlPreview)}
                          >
                            <Link2 size={15} />
                            URL Preview
                          </button>
                          <div className="menu-anchor">
                            <button
                              className="button small icon-only"
                              aria-label="Parameter options"
                              aria-expanded={menu === 'parameters'}
                              onClick={() => setMenu(menu === 'parameters' ? null : 'parameters')}
                            >
                              <MoreHorizontal size={20} />
                            </button>
                            {menu === 'parameters' && (
                              <>
                                <div className="menu-dismiss" onClick={() => setMenu(null)} />
                                <div className="dropdown-menu parameter-menu">
                                  <button
                                    onClick={() => {
                                      changeRequest({
                                        query: request.query.map((item) => ({
                                          ...item,
                                          enabled: true,
                                        })),
                                      });
                                      setMenu(null);
                                    }}
                                  >
                                    <Check size={15} />
                                    Enable all parameters
                                  </button>
                                  <button
                                    onClick={() => {
                                      changeRequest({
                                        query: request.query.map((item) => ({
                                          ...item,
                                          enabled: false,
                                        })),
                                      });
                                      setMenu(null);
                                    }}
                                  >
                                    <Square size={15} />
                                    Disable all parameters
                                  </button>
                                  <button
                                    onClick={() => {
                                      changeRequest({ query: [...request.query, row()] });
                                      setMenu(null);
                                    }}
                                  >
                                    <Plus size={15} />
                                    Add parameter
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {urlPreview && (
                        <div className="url-preview">
                          <code>{preview}</code>
                          <button
                            className="icon-button"
                            aria-label="Copy URL"
                            onClick={() => void copy(preview)}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      )}
                      <KeyValueEditor
                        rows={request.query}
                        onChange={(query) => changeRequest({ query })}
                      />
                    </>
                  )}
                  {requestView === 'Headers' && (
                    <>
                      <div className="section-heading">
                        <h2>Request Headers</h2>
                        <span className="muted-label">
                          Enabled headers are sent with your request
                        </span>
                      </div>
                      <KeyValueEditor
                        rows={request.headers}
                        kind="header"
                        onChange={(headers) => changeRequest({ headers })}
                      />
                    </>
                  )}
                  {requestView === 'Body' && (
                    <>
                      <div className="section-heading">
                        <div className="body-types">
                          {(['none', 'json', 'text', 'form'] as const).map((type) => (
                            <label key={type}>
                              <input
                                type="radio"
                                name="bodyType"
                                checked={request.bodyType === type}
                                onChange={() => changeRequest({ bodyType: type })}
                              />
                              {type === 'json'
                                ? 'JSON'
                                : type === 'form'
                                  ? 'URL encoded'
                                  : type[0].toUpperCase() + type.slice(1)}
                            </label>
                          ))}
                        </div>
                        {request.bodyType === 'json' && (
                          <button
                            className="subtle-button"
                            onClick={() => {
                              try {
                                changeRequest({
                                  body: JSON.stringify(JSON.parse(request.body), null, 2),
                                });
                              } catch {
                                notify('This body is not valid JSON.');
                              }
                            }}
                          >
                            Format JSON
                          </button>
                        )}
                      </div>
                      {request.bodyType === 'none' ? (
                        <div className="body-empty">
                          <FileCode2 size={25} />
                          <p>This request has no body.</p>
                          <span>Choose a format above to add one.</span>
                        </div>
                      ) : (
                        <>
                          <textarea
                            className="body-editor"
                            aria-label="Request body"
                            spellCheck={false}
                            placeholder={
                              request.bodyType === 'json'
                                ? '{\n  "key": "value"\n}'
                                : request.bodyType === 'form'
                                  ? 'key=value&another=value'
                                  : 'Enter request body...'
                            }
                            value={request.body}
                            onChange={(e) => changeRequest({ body: e.target.value })}
                          />
                          {request.bodyType === 'form' && (
                            <p className="field-hint">
                              Use URL-encoded text, for example name=Alex&amp;role=admin.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {requestView === 'Auth' && (
                    <div className="auth-panel">
                      <div className="auth-type">
                        <h2>Authorization</h2>
                        <select
                          aria-label="Authorization type"
                          value={request.auth.type}
                          onChange={(e) =>
                            changeRequest({ auth: { type: e.target.value as Auth['type'] } })
                          }
                        >
                          <option value="none">No Auth</option>
                          <option value="bearer">Bearer Token</option>
                          <option value="basic">Basic Auth</option>
                          <option value="apiKey">API Key</option>
                        </select>
                        <p>
                          <ShieldCheck size={14} />
                          Credentials are session-only. Use secret environment variables to keep
                          requests reusable.
                        </p>
                      </div>
                      <div className="auth-fields">
                        {request.auth.type === 'none' ? (
                          <div className="auth-none">
                            <ShieldCheck size={26} />
                            <p>This request does not use authorization.</p>
                          </div>
                        ) : request.auth.type === 'bearer' ? (
                          <label className="field-label">
                            Token
                            <input
                              type="password"
                              aria-label="Bearer token"
                              placeholder="{{access_token}}"
                              value={request.auth.token ?? ''}
                              onChange={(e) => updateAuth({ token: e.target.value })}
                            />
                          </label>
                        ) : request.auth.type === 'basic' ? (
                          <>
                            <label className="field-label">
                              Username
                              <input
                                autoComplete="off"
                                value={request.auth.username ?? ''}
                                onChange={(e) => updateAuth({ username: e.target.value })}
                              />
                            </label>
                            <label className="field-label">
                              Password
                              <input
                                type="password"
                                autoComplete="off"
                                value={request.auth.password ?? ''}
                                onChange={(e) => updateAuth({ password: e.target.value })}
                              />
                            </label>
                          </>
                        ) : (
                          <>
                            <label className="field-label">
                              Key
                              <input
                                placeholder="X-API-Key"
                                value={request.auth.key ?? ''}
                                onChange={(e) => updateAuth({ key: e.target.value })}
                              />
                            </label>
                            <label className="field-label">
                              Value
                              <input
                                type="password"
                                placeholder="{{api_key}}"
                                value={request.auth.value ?? ''}
                                onChange={(e) => updateAuth({ value: e.target.value })}
                              />
                            </label>
                            <label className="field-label">
                              Add to
                              <select
                                value={request.auth.location ?? 'header'}
                                onChange={(e) =>
                                  updateAuth({ location: e.target.value as 'header' | 'query' })
                                }
                              >
                                <option value="header">Header</option>
                                <option value="query">Query params</option>
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
            <section className="response-panel" aria-label="Response">
              <div
                className="response-divider"
                role="separator"
                aria-label="Resize request and response"
                aria-orientation="horizontal"
                aria-valuenow={Math.round(split)}
                tabIndex={0}
                onPointerDown={resizePanels}
                onDoubleClick={() => setSplit(43)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSplit((v) => Math.min(70, Math.max(25, v + (e.key === 'ArrowUp' ? -3 : 3))));
                  }
                }}
              >
                <span />
              </div>
              <div className="response-heading">
                <h2>
                  <ChevronDown size={15} />
                  Response
                </h2>
                <div className="response-heading-actions">
                  {response && (
                    <>
                      <div className="menu-anchor">
                        <button
                          className="button small"
                          aria-haspopup="menu"
                          aria-expanded={menu === 'response'}
                          onClick={() => setMenu(menu === 'response' ? null : 'response')}
                        >
                          {isDesktop() ? <Copy size={17} /> : <ArrowDownToLine size={17} />}
                          <span>{isDesktop() ? 'Copy Response' : 'Save Response'}</span>
                          <ChevronDown size={14} />
                        </button>
                        {menu === 'response' && (
                          <>
                            <div className="menu-dismiss" onClick={() => setMenu(null)} />
                            <div className="dropdown-menu response-menu" role="menu">
                              {[false, true].map((formatted) => (
                                <button
                                  role="menuitem"
                                  key={String(formatted)}
                                  onClick={() => {
                                    const text = formatted
                                      ? prettyBody(response.body)
                                      : response.body;
                                    if (isDesktop()) void copy(text);
                                    else {
                                      downloadText(
                                        `response-${response.status}.${jsonResponse ? 'json' : 'txt'}`,
                                        text,
                                        response.contentType || 'text/plain',
                                      );
                                      notify('Response download started.');
                                    }
                                    setMenu(null);
                                  }}
                                >
                                  <ArrowDownToLine size={15} />
                                  {isDesktop() ? 'Copy' : 'Save'} {formatted ? 'formatted' : 'raw'}{' '}
                                  response
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        className="icon-button"
                        title="Copy response"
                        aria-label="Copy response"
                        onClick={() => void copy(response.body)}
                      >
                        <Copy size={16} />
                      </button>
                    </>
                  )}
                  <div className="menu-anchor">
                    <button
                      className="icon-button"
                      aria-label="Response options"
                      aria-haspopup="menu"
                      aria-expanded={menu === 'responseOptions'}
                      onClick={() => setMenu(menu === 'responseOptions' ? null : 'responseOptions')}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    {menu === 'responseOptions' && (
                      <>
                        <div className="menu-dismiss" onClick={() => setMenu(null)} />
                        <div className="dropdown-menu response-menu" role="menu">
                          <button
                            role="menuitem"
                            onClick={() => {
                              setResponseExpanded(!responseExpanded);
                              setMenu(null);
                            }}
                          >
                            {responseExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{' '}
                            {responseExpanded ? 'Restore request editor' : 'Expand response'}
                          </button>
                          {response && (
                            <button
                              role="menuitem"
                              onClick={() => {
                                void copy(response.url, 'Response URL copied.');
                                setMenu(null);
                              }}
                            >
                              <Link2 size={15} />
                              Copy response URL
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="response-empty">
                  <div className="empty-icon">
                    <Loader2 className="spin" size={27} />
                  </div>
                  <h3>Sending request</h3>
                  <p>Waiting for your API to respond.</p>
                  <button className="subtle-button" onClick={() => void stop()}>
                    Cancel request
                  </button>
                </div>
              ) : active.error ? (
                <div className="response-error">
                  <div className="error-symbol">!</div>
                  <h3>Couldn't complete the request</h3>
                  <p>{active.error}</p>
                  <button className="button" onClick={() => void send()}>
                    <ArrowRight size={15} />
                    Try again
                  </button>
                </div>
              ) : response ? (
                <>
                  <div className="response-metadata">
                    <span
                      className={`status-badge ${statusGood ? 'success' : response.status >= 400 ? 'failure' : ''}`}
                    >
                      {response.status} {response.statusText}
                    </span>
                    <span>
                      <Clock3 size={14} />
                      {response.durationMs} ms
                    </span>
                    <span>
                      <Layers3 size={14} />
                      {formatBytes(response.sizeBytes)}
                    </span>
                    {response.truncated && <span className="truncated">Response truncated</span>}
                    <span className="response-url" title={response.url}>
                      {response.url}
                    </span>
                  </div>
                  <div
                    className="section-tabs response-tabs"
                    role="tablist"
                    aria-label="Response sections"
                  >
                    {['Body', 'Headers', 'Cookies', 'Timing'].map((name) => (
                      <button
                        role="tab"
                        aria-selected={responseView === name}
                        key={name}
                        className={responseView === name ? 'active' : ''}
                        onClick={() => setResponseView(name)}
                      >
                        {name}
                        {name === 'Headers' && (
                          <span className="count-badge">{response.headers.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="response-content">
                    {responseView === 'Body' ? (
                      <div className="response-code">
                        <div className="code-toolbar">
                          <select
                            className="code-format"
                            aria-label="Response syntax"
                            value={jsonResponse ? 'json' : 'text'}
                            onChange={(e) => setResponseFormat(e.target.value as 'json' | 'text')}
                          >
                            <option value="json">JSON</option>
                            <option value="text">Text</option>
                          </select>
                          <select
                            aria-label="Response formatting"
                            value={pretty ? 'pretty' : 'raw'}
                            onChange={(e) => setPretty(e.target.value === 'pretty')}
                          >
                            <option value="pretty">Pretty</option>
                            <option value="raw">Raw</option>
                          </select>
                          <button
                            className={`icon-button ${wrap ? 'active' : ''}`}
                            title="Toggle line wrap"
                            aria-label="Toggle line wrap"
                            onClick={() => setWrap(!wrap)}
                          >
                            <WrapText size={16} />
                          </button>
                          <div className="toolbar-spacer" />
                          {showResponseSearch && (
                            <input
                              className="response-search"
                              autoFocus
                              placeholder="Find in response..."
                              aria-label="Find in response"
                              value={responseSearch}
                              onChange={(e) => setResponseSearch(e.target.value)}
                            />
                          )}
                          <button
                            className="icon-button"
                            title="Find in response"
                            aria-label="Find in response"
                            onClick={() => {
                              setShowResponseSearch(!showResponseSearch);
                              if (showResponseSearch) setResponseSearch('');
                            }}
                          >
                            <Search size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Copy displayed response"
                            title="Copy displayed response"
                            onClick={() => void copy(prettyResponse)}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            className="icon-button"
                            title={responseExpanded ? 'Restore request editor' : 'Expand response'}
                            aria-label={
                              responseExpanded ? 'Restore request editor' : 'Expand response'
                            }
                            onClick={() => setResponseExpanded(!responseExpanded)}
                          >
                            {responseExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                          </button>
                        </div>
                        {response.body ? (
                          <CodeViewer
                            text={prettyResponse}
                            json={jsonResponse}
                            wrap={wrap}
                            search={responseSearch}
                          />
                        ) : (
                          <div className="empty-body">The server returned an empty body.</div>
                        )}
                      </div>
                    ) : responseView === 'Headers' ? (
                      <div className="response-table">
                        <div className="response-table-head">
                          <span>HEADER</span>
                          <span>VALUE</span>
                        </div>
                        {response.headers.map((h, i) => (
                          <div className="response-table-row" key={i}>
                            <code>{h.key}</code>
                            <code>{h.value}</code>
                          </div>
                        ))}
                        {!isDesktop() && (
                          <p className="field-hint">
                            Browser preview only exposes headers allowed by the server's CORS
                            policy.
                          </p>
                        )}
                      </div>
                    ) : responseView === 'Cookies' ? (
                      <div className="response-table">
                        {response.headers
                          .filter((h) => h.key.toLowerCase() === 'set-cookie')
                          .map((h, i) => (
                            <div className="cookie-value" key={i}>
                              <code>{h.value}</code>
                            </div>
                          ))}
                        <div className="info-empty">
                          <Info size={21} />
                          <p>
                            {!isDesktop()
                              ? 'Browsers hide Set-Cookie headers. Use the desktop app to inspect cookies.'
                              : response.headers.some((h) => h.key.toLowerCase() === 'set-cookie')
                                ? 'Cookies shown above are response headers. Req does not maintain a cookie jar.'
                                : 'No Set-Cookie headers were returned. Req does not maintain a cookie jar.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="timing-view">
                        <div className="timing-card">
                          <Clock3 size={21} />
                          <span>Total request time</span>
                          <strong>
                            {response.durationMs}
                            <small> ms</small>
                          </strong>
                        </div>
                        <div className="timing-bar" />
                        <p>
                          Elapsed time from sending the request to receiving its body. DNS, TLS, and
                          connection timings are not measured separately.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="response-empty">
                  <div className="empty-icon">
                    <ArrowRight size={27} />
                  </div>
                  <h3>Ready when you are</h3>
                  <p>Send a request to see the response here.</p>
                  <span className="keyboard-hint">
                    <kbd>⌘</kbd>
                    <kbd>↵</kbd>
                    <span>to send your request</span>
                  </span>
                </div>
              )}
            </section>
          </div>
          <footer className="statusbar">
            <span>
              <span className="status-dot" />
              {loadFailed
                ? 'Local saving paused'
                : isDesktop()
                  ? 'Native HTTP engine'
                  : 'Browser preview'}
              <span className="status-separator">·</span>
              {isDesktop()
                ? 'No browser CORS restrictions'
                : 'Requests are subject to browser CORS'}
            </span>
            <button onClick={() => setDialog('settings')}>
              Local-first<span className="status-separator">·</span>v0.1.0
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          title={
            dialog === 'import'
              ? 'Import from cURL'
              : dialog === 'save'
                ? 'Save request'
                : dialog === 'environments'
                  ? 'Environments'
                  : dialog === 'settings'
                    ? 'Your workspace'
                    : dialog === 'requestSettings'
                      ? 'Request options'
                      : dialog === 'ai'
                        ? 'A little help, on your terms'
                        : dialog === 'curl'
                          ? 'Export as cURL'
                          : dialog === 'folder'
                            ? 'New folder'
                            : dialog === 'workspaceExport'
                              ? 'Export workspace'
                              : dialog === 'discard'
                                ? 'Close without saving?'
                                : dialog === 'deleteEnvironment'
                                  ? 'Delete environment?'
                                  : 'Delete saved request?'
          }
          description={
            dialog === 'environments'
              ? 'Reusable values for every place your API runs.'
              : dialog === 'import'
                ? 'Paste one cURL command. You can review everything before sending.'
                : undefined
          }
          wide={dialog === 'environments' || dialog === 'curl' || dialog === 'workspaceExport'}
          onClose={() => setDialog(null)}
        >
          {dialog === 'import' && (
            <>
              <textarea
                className="curl-editor"
                aria-label="cURL command"
                placeholder={
                  'curl https://api.example.com/users \\\n  -H "Accept: application/json"'
                }
                spellCheck={false}
                value={curlText}
                onChange={(e) => setCurlText(e.target.value)}
              />
              <p className="field-hint">
                Supports URL, method, headers, body, basic auth and timeout. Unsupported options are
                reported instead of silently ignored.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={!curlText.trim() || importBusy}
                  onClick={() => void doImport()}
                >
                  {importBusy ? <Loader2 className="spin" size={15} /> : <Terminal size={15} />}
                  Import request
                </button>
              </div>
            </>
          )}
          {dialog === 'save' && (
            <>
              <label className="field-label">
                Request name
                <input
                  autoFocus
                  placeholder="e.g. List users"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                  }}
                />
              </label>
              <label className="field-label">
                Save to
                <select value={saveFolder} onChange={(e) => setSaveFolder(e.target.value)}>
                  <option value="">Unfiled</option>
                  {workspace.folders.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <div className="privacy-note">
                <ShieldCheck size={17} />
                <p>
                  Saved on this device. Auth credentials and secret variables are not retained.
                  Request bodies are saved, so use secret variables for sensitive values.
                </p>
              </div>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button className="button primary" disabled={saveBusy} onClick={() => void save()}>
                  <Save size={15} />
                  {saveBusy ? 'Saving…' : 'Save request'}
                </button>
              </div>
            </>
          )}
          {dialog === 'folder' && (
            <>
              <label className="field-label">
                Folder name
                <input
                  autoFocus
                  placeholder="e.g. Payments API"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    if (!folderName.trim()) {
                      setDialogError('Enter a folder name.');
                      return;
                    }
                    if (workspace.folders.includes(folderName.trim())) {
                      setDialogError('A folder with this name already exists.');
                      return;
                    }
                    setWorkspace((w) => ({ ...w, folders: [...w.folders, folderName.trim()] }));
                    setOpenFolders((o) => [...o, folderName.trim()]);
                    setDialog(null);
                  }}
                >
                  Create folder
                </button>
              </div>
            </>
          )}
          {dialog === 'discard' && (
            <>
              <p className="dialog-copy">
                This request has unsaved changes. Closing it will discard those changes.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Keep editing
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    closeTab(closingId, true);
                    setDialog(null);
                  }}
                >
                  Close without saving
                </button>
              </div>
            </>
          )}
          {dialog === 'deleteEnvironment' && (
            <>
              <p className="dialog-copy">
                Remove “{editEnvironment?.name}” and its variables from this workspace?
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog('environments')}>
                  Cancel
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    setWorkspace((w) => ({
                      ...w,
                      environments: w.environments.filter((e) => e.id !== envEditId),
                      activeEnvironmentId:
                        w.activeEnvironmentId === envEditId ? '' : w.activeEnvironmentId,
                    }));
                    setEnvEditId('');
                    setDialog('environments');
                  }}
                >
                  Delete environment
                </button>
              </div>
            </>
          )}
          {dialog === 'delete' && (
            <>
              <p className="dialog-copy">
                Remove “{workspace.saved.find((r) => r.id === deleteId)?.name}” from your saved
                requests? Any open tab will stay available.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    setWorkspace((w) => ({
                      ...w,
                      saved: w.saved.filter((r) => r.id !== deleteId),
                    }));
                    setDialog(null);
                    notify('Saved request removed. Open tabs are unchanged.');
                  }}
                >
                  <Trash2 size={15} />
                  Delete request
                </button>
              </div>
            </>
          )}
          {dialog === 'requestSettings' && (
            <>
              <label className="field-label">
                Timeout (seconds)
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={request.timeoutMs / 1000}
                  onChange={(e) =>
                    changeRequest({
                      timeoutMs: Math.min(300, Math.max(1, Number(e.target.value) || 1)) * 1000,
                    })
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Follow redirects</strong>
                  <small>
                    {isDesktop()
                      ? 'Follow same-origin redirects. Cross-origin redirects return their 3xx response to protect credentials.'
                      : 'Redirect following requires the desktop app. Browser preview blocks redirects.'}
                  </small>
                </span>
                <input
                  type="checkbox"
                  disabled={!isDesktop()}
                  checked={request.followRedirects}
                  onChange={(e) => changeRequest({ followRedirects: e.target.checked })}
                />
              </label>
              <div className="privacy-note">
                <ShieldCheck size={17} />
                <p>
                  TLS certificate verification is always enabled. Requests do not send or store a
                  cookie jar.
                </p>
              </div>
              <div className="modal-actions">
                <button className="button primary" onClick={() => setDialog(null)}>
                  Done
                </button>
              </div>
            </>
          )}
          {dialog === 'environments' && (
            <>
              <div className="environment-tabs">
                {workspace.environments.map((e) => (
                  <button
                    className={editEnvironment?.id === e.id ? 'active' : ''}
                    key={e.id}
                    onClick={() => setEnvEditId(e.id)}
                  >
                    <span
                      className={workspace.activeEnvironmentId === e.id ? 'env-active-dot' : ''}
                    />
                    {e.name}
                  </button>
                ))}
                <button
                  aria-label="Add environment"
                  onClick={() => {
                    const e = {
                      id: uid(),
                      name: `Environment ${workspace.environments.length + 1}`,
                      variables: [row()],
                    };
                    setWorkspace((w) => ({ ...w, environments: [...w.environments, e] }));
                    setEnvEditId(e.id);
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>
              {editEnvironment && (
                <>
                  <label className="field-label environment-name">
                    Environment name
                    <input
                      value={editEnvironment.name}
                      onChange={(e) =>
                        updateEnvironment(editEnvironment.id, { name: e.target.value })
                      }
                    />
                  </label>
                  <KeyValueEditor
                    rows={editEnvironment.variables}
                    kind="variable"
                    onChange={(variables) => updateEnvironment(editEnvironment.id, { variables })}
                  />
                  <div className="privacy-note">
                    <ShieldCheck size={17} />
                    <p>
                      Use {'{{variable_name}}'} in your URL, headers, auth or body. Secret values
                      stay in memory and must be re-entered after restarting. Click the eye icon to
                      mark a variable secret.
                    </p>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="subtle-button"
                      onClick={() => setDialog('deleteEnvironment')}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        setWorkspace((w) => ({ ...w, activeEnvironmentId: editEnvironment.id }));
                        notify(`${editEnvironment.name} is now active.`);
                      }}
                    >
                      <Check size={15} />
                      Use environment
                    </button>
                    <button className="button primary" onClick={() => setDialog(null)}>
                      Done
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {dialog === 'ai' && (
            <>
              <div className="ai-intro">
                <div className="ai-orb">
                  <Sparkles size={30} />
                </div>
                <h3>Nothing leaves your workspace by default.</h3>
                <p>
                  AI assistance is not connected in this version. Your requests, headers, and
                  responses are never sent to an AI provider.
                </p>
              </div>
              <div className="feature-alternative">
                <Terminal size={20} />
                <div>
                  <strong>Already have a cURL command?</strong>
                  <span>Turn it into an editable request, entirely on your device.</span>
                </div>
                <button
                  className="button"
                  onClick={() => {
                    setCurlText('');
                    setDialog('import');
                  }}
                >
                  Import cURL
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="modal-actions">
                <button className="button primary" onClick={() => setDialog(null)}>
                  Got it
                </button>
              </div>
            </>
          )}
          {dialog === 'curl' && (
            <>
              <div className="privacy-note warning">
                <Info size={17} />
                <p>
                  This command includes resolved environment values and may contain credentials.
                  Review it before copying or sharing.
                </p>
              </div>
              <textarea
                className="curl-editor exported-curl"
                aria-label="Exported cURL"
                readOnly
                value={curlText}
                spellCheck={false}
              />
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Close
                </button>
                <button
                  className="button primary"
                  onClick={() =>
                    void copy(curlText, 'cURL command copied. Keep any credentials private.')
                  }
                >
                  <Copy size={15} />
                  Copy command
                </button>
              </div>
            </>
          )}
          {dialog === 'workspaceExport' && (
            <>
              <div className="privacy-note warning">
                <Info size={17} />
                <p>
                  Known credential fields and response bodies are omitted. Raw request bodies or
                  custom fields may still contain secrets. Review this file before sharing.
                </p>
              </div>
              <textarea
                className="curl-editor exported-curl"
                aria-label="Exported workspace"
                readOnly
                value={curlText}
                spellCheck={false}
              />
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(null)}>
                  Close
                </button>
                {!isDesktop() && (
                  <button
                    className="button"
                    onClick={() => {
                      downloadText('req-workspace.json', curlText, 'application/json');
                      notify('Workspace download started.');
                    }}
                  >
                    <ArrowDownToLine size={15} />
                    Download JSON
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() =>
                    void copy(
                      curlText,
                      'Workspace JSON copied. Review any sensitive values before sharing.',
                    )
                  }
                >
                  <Copy size={15} />
                  Copy JSON
                </button>
              </div>
            </>
          )}
          {dialog === 'settings' && (
            <>
              <div className="about-brand">
                <span className="brand-icon large">
                  R<span>↗</span>
                </span>
                <div>
                  <h3>
                    Req <span>0.1.0</span>
                  </h3>
                  <p>A quiet place for your APIs.</p>
                </div>
              </div>
              <div className="settings-facts">
                <div>
                  <ShieldCheck size={19} />
                  <span>
                    <strong>{loadFailed ? 'Local saving is paused' : 'Local by default'}</strong>
                    <small>
                      {loadFailed
                        ? 'An existing workspace could not be loaded. Restart the app after recovering the data. This session will not overwrite it.'
                        : isDesktop()
                          ? 'Workspace data is stored in your operating system’s app-data folder.'
                          : 'This browser preview stores your workspace in this browser’s local storage.'}{' '}
                      No account, sync, or analytics.
                    </small>
                  </span>
                </div>
                <div>
                  <Globe2 size={19} />
                  <span>
                    <strong>{isDesktop() ? 'Native HTTP' : 'Browser preview'}</strong>
                    <small>
                      {isDesktop()
                        ? 'Requests run through Rust, without browser CORS restrictions.'
                        : 'CORS and browser-controlled headers apply here. Native HTTP is available when running the Tauri desktop app.'}
                    </small>
                  </span>
                </div>
                <div>
                  <Zap size={19} />
                  <span>
                    <strong>Secrets stay in your session</strong>
                    <small>
                      Auth tokens, passwords and variables marked secret are omitted from persisted
                      data. Raw bodies may contain sensitive values. Use secret placeholders before
                      saving.
                    </small>
                  </span>
                </div>
                <div>
                  <Clock3 size={19} />
                  <span>
                    <strong>Only the history you need</strong>
                    <small>
                      The latest 100 requests and their status are saved locally. Response bodies
                      are never persisted.
                    </small>
                  </span>
                </div>
              </div>
              <div className="shortcut-list">
                <span>
                  Send request<kbd>⌘ ↵</kbd>
                </span>
                <span>
                  Save request<kbd>⌘ S</kbd>
                </span>
                <span>
                  New request<kbd>⌘ T</kbd>
                </span>
                <span>
                  Search requests<kbd>⌘ K</kbd>
                </span>
              </div>
              <div className="modal-actions settings-actions">
                <button
                  className="subtle-button"
                  disabled={!workspace.history.length}
                  onClick={() => {
                    setWorkspace((w) => ({ ...w, history: [] }));
                    notify('Request history cleared from this workspace.');
                  }}
                >
                  <Trash2 size={14} />
                  Clear history
                </button>
                <button className="button primary" onClick={() => setDialog(null)}>
                  Done
                </button>
              </div>
            </>
          )}
          {dialogError && (
            <div className="dialog-error" role="alert">
              {dialogError}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
