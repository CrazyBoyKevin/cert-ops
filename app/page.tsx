"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { appRouteHref, readAppRoute, loginHref, type AppRoute, type SettingsTab } from "@/lib/app-route";
import {
  AlertTriangle, BellRing, Check, CheckCircle2, ChevronRight, Copy, Download, Eye, EyeOff, FileKey2,
  Folder, FolderPlus, LockKeyhole, LogOut, Mail, MessageSquare, Pencil, Plus,
  RefreshCw, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Trash2, UploadCloud,
  WifiOff, X,
} from "lucide-react";
import { LANGUAGES, messages, type Language, type Messages } from "@/lib/i18n";
import type { Certificate, Group, NotificationSettings, StorageMode } from "@/lib/types";
import { AcmeModal, AcmeSettingsPanel, CertificateAcmePanel } from "./acme-panel";
import { PrivateCaSettings, PrivateIssueModal, PrivateCertificatePanel, PrivateImportModal, type Authority } from "./private-pki-panel";
import { certificateMetrics, certificateWorkspaceScope, certificatesInProject, certificatesInScope, type CertificateScope } from "@/lib/certificate-scope";
import { navigationMessages } from "@/lib/navigation-i18n";
import { pkiManagementMessages } from "@/lib/pki-management-i18n";
import { pkiMessages } from "@/lib/private-pki-i18n";
import { canonicalAddress } from "@/lib/ip-address";
import { acmeMessages } from "@/lib/acme-i18n";
import { certificateExportNames, type CertificateExportContents } from "@/lib/certificate-export";
import { copyText } from "@/lib/clipboard";
import { Brand } from "./brand";
import { LanguageSwitcher } from "./language-switcher";

const EMPTY_SETTINGS: NotificationSettings = {
  dingtalkEnabled: false, dingtalkWebhook: "", dingtalkSecret: "", feishuEnabled: false, feishuWebhook: "", feishuSecret: "",
  emailEnabled: false, smtpHost: "", smtpPort: 465, smtpSecure: true, smtpUser: "",
  smtpPassword: "", emailFrom: "", emailRecipients: "",
};

async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) {
    window.location.replace(loginHref(window.location.pathname + window.location.search));
    throw new Error("UNAUTHORIZED");
  }
  return response;
}

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

function statusOf(certificate: Certificate) {
  const days = daysUntil(certificate.expiresAt);
  if (days < 0) return { key: "expired", tone: "red", days };
  if (days <= 15) return { key: "urgent", tone: "red", days };
  if (days <= 30) return { key: "warning", tone: "amber", days };
  return { key: "healthy", tone: "green", days };
}

function statusLabel(certificate: Certificate, copy: Messages) {
  const status = statusOf(certificate);
  if (status.key === "expired") return copy.expiredLabel;
  if (status.key === "healthy") return copy.normalLabel;
  return `${status.days} ${copy.daysLater}`;
}

function formatDate(date: string, language: Language) {
  const locale = language === "en" ? "en-US" : language;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

export default function Home() {
  return <Suspense fallback={<main className="login-shell"><span role="status">CertOps · Loading…</span></main>}><Workspace /></Suspense>;
}

function Workspace() {
  const router = useRouter(), searchParams = useSearchParams(), pathname = usePathname();
  const route = readAppRoute(searchParams, pathname);
  const groupFilter = route.project, certificateScope = route.type, privateView = route.view, authorityFilter = route.ca, statusFilter = route.status;
  const settingsOpen = route.settings !== null;
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [storage, setStorage] = useState<StorageMode>("demo");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [acmeOpen, setAcmeOpen] = useState(false);
  const [privateIssueOpen, setPrivateIssueOpen] = useState(false);
  const [privateImportOpen, setPrivateImportOpen] = useState(false);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const detailTarget = certificates.find(certificate => certificate.id === route.certificate) || null;
  const [editTarget, setEditTarget] = useState<Certificate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Certificate | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState<Group | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<Group | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(EMPTY_SETTINGS);
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [currentUsername, setCurrentUsername] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const copy = messages[language];
  const management = pkiManagementMessages(language);
  const navigation = navigationMessages(language);
  const scopeTitle = certificateScope === "private" ? management.privateArea : management.publicArea;
  const workspaceScope = certificateWorkspaceScope(groupFilter, groups.map(group => group.id), certificateScope, authorityFilter);
  const needsProject = workspaceScope === "none";
  const projectTitle = workspaceScope === "authority" ? navigation.caServices : groups.find(group => group.id === groupFilter)?.name || navigation.chooseProject;
  const projectCertificates = useMemo(() => certificatesInProject(certificates, groupFilter), [certificates, groupFilter]);
  const scopeCertificates = useMemo(() => certificatesInScope(projectCertificates, certificateScope, authorityFilter), [projectCertificates, certificateScope, authorityFilter]);
  const publicCount = certificatesInScope(projectCertificates, "public").length;
  const privateCount = certificatesInScope(projectCertificates, "private").length;

  function navigate(patch: Partial<AppRoute>, replace = false) {
    const href = appRouteHref({ ...route, ...patch });
    if (href === appRouteHref(route)) return;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }
  function setDetailTarget(certificate: Certificate | null) { navigate({ certificate: certificate?.id || null, settings: null }); }
  function setAuthorityFilter(ca: string) { navigate({ ca, certificate: null }); }
  function setPrivateView(view: AppRoute["view"]) { navigate({ view, certificate: null, settings: null }); setSearch(""); }
  function setStatusFilter(status: string) { navigate({ status: status as AppRoute["status"] }); }

  function changeScope(scope: CertificateScope) {
    navigate({ type: scope, ca: "all", view: "services", certificate: null, settings: null, status: "all" }); setSearch("");
  }
  function changeProject(id: string) {
    navigate({ project: id, view: "services", ca: "all", certificate: null, settings: null, status: "all" }); setSearch("");
  }
  useEffect(() => {
    if (certificateScope !== "private" && privateView !== "roots") return;
    let active = true;
    authenticatedFetch("/api/private-pki", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (active) setAuthorities(result.data || []);
      // Loading the PKI schema also backfills historical CA associations.
      const certificatesResponse = await authenticatedFetch("/api/certificates", { cache: "no-store" });
      const certificatesResult = await certificatesResponse.json();
      if (active && certificatesResponse.ok) setCertificates(certificatesResult.data || []);
    }).catch(() => { if (active) setToast({ type: "error", text: messages[language].operationFailed }); });
    return () => { active = false; };
  }, [certificateScope, privateView, privateIssueOpen, privateImportOpen, language]);

  async function loadData(showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const [certResponse, groupResponse, settingsResponse] = await Promise.all([
        authenticatedFetch("/api/certificates", { cache: "no-store" }), authenticatedFetch("/api/groups", { cache: "no-store" }), authenticatedFetch("/api/settings", { cache: "no-store" }),
      ]);
      const [certJson, groupJson, settingsJson] = await Promise.all([certResponse.json(), groupResponse.json(), settingsResponse.json()]);
      setCertificates(certJson.data || []);
      setGroups(groupJson.data || []);
      setStorage(certJson.storage || groupJson.storage || "demo");
      setSettings({ ...EMPTY_SETTINGS, ...(settingsJson.data || {}) });
      return (certJson.data || []) as Certificate[];
    } catch {
      showToast("error", copy.operationFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const storedLanguage = window.localStorage.getItem("certops-language");
    if (LANGUAGES.some((item) => item.code === storedLanguage)) {
      const savedLanguage = storedLanguage as Language;
      window.setTimeout(() => {
        if (active) {
          setLanguage(savedLanguage);
          document.documentElement.lang = savedLanguage;
        }
      }, 0);
    }
    Promise.all([
      authenticatedFetch("/api/certificates", { cache: "no-store" }),
      authenticatedFetch("/api/groups", { cache: "no-store" }),
      authenticatedFetch("/api/settings", { cache: "no-store" }),
      authenticatedFetch("/api/auth/session", { cache: "no-store" }),
    ])
      .then(async ([certResponse, groupResponse, settingsResponse, sessionResponse]) => Promise.all([
        certResponse.json(), groupResponse.json(), settingsResponse.json(), sessionResponse.json(),
      ]))
      .then(([certJson, groupJson, settingsJson, sessionJson]) => {
        if (!active) return;
        setCertificates(certJson.data || []);
        setGroups(groupJson.data || []);
        setStorage(certJson.storage || groupJson.storage || "demo");
        setSettings({ ...EMPTY_SETTINGS, ...(settingsJson.data || {}) });
        setCurrentUsername(sessionJson.data?.username || "");
      })
      .catch(() => {
        if (active) setToast({ type: "error", text: messages["zh-CN"].operationFailed });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3200);
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    window.localStorage.setItem("certops-language", next);
    document.documentElement.lang = next;
    showToast("success", messages[next].languageChanged);
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.replace("/login");
    }
  }

  const filtered = useMemo(() => scopeCertificates.filter((certificate) => {
    const query = canonicalAddress(search.toLowerCase().trim());
    const matchesSearch = !query || certificate.domains.some(domain => domain.toLowerCase().includes(query)) || certificate.name.toLowerCase().includes(query) || certificate.issuer.toLowerCase().includes(query);
    const status = statusOf(certificate);
    const matchesStatus = statusFilter === "all" || (statusFilter === "expiring" && status.days >= 0 && status.days <= 30) || status.key === statusFilter;
    return matchesSearch && matchesStatus;
  }), [scopeCertificates, search, statusFilter]);

  const metrics = useMemo(() => certificateMetrics(projectCertificates), [projectCertificates]);

  async function handleDelete() {
    if (!deleteTarget || !deleteConfirmed) return;
    const response = await authenticatedFetch("/api/certificates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id, confirmed: true }) });
    const json = await response.json();
    if (!response.ok) return showToast("error", json.error || copy.operationFailed);
    setCertificates((items) => items.filter((item) => item.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteConfirmed(false);
    showToast("success", copy.deleted);
    void loadData();
  }

  async function persistSettings(silent = false) {
    const response = await authenticatedFetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const json = await response.json();
    if (!response.ok) { showToast("error", json.error || copy.operationFailed); return false; }
    setSettings(json.data);
    if (!silent) showToast("success", copy.settingsSaved);
    return true;
  }

  async function testNotification() {
    if (!(await persistSettings(true))) return;
    const response = await authenticatedFetch("/api/notifications/test", { method: "POST" });
    const json = await response.json();
    if (!response.ok || !json.success) {
      const details = Array.isArray(json.results) ? json.results.filter((item: { success: boolean }) => !item.success).map((item: { detail: string }) => item.detail).join("；") : "";
      return showToast("error", details || json.error || copy.operationFailed);
    }
    showToast("success", copy.testSent);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-section groups-primary project-navigation" aria-label={navigation.certificates}>
          <div className="section-label"><span>{copy.projectGroups}</span><button aria-label={copy.newGroup} onClick={() => setGroupOpen(true)}><Plus size={15} /></button></div>
          {groups.map((group) => (
            <div key={group.id} className={`group-entry ${!settingsOpen && privateView === "services" && groupFilter === group.id ? "selected" : ""}`}>
              <button className={`group-item ${!settingsOpen && privateView === "services" && groupFilter === group.id ? "selected" : ""}`} aria-current={!settingsOpen && privateView === "services" && groupFilter === group.id ? "page" : undefined} title={group.name} aria-label={group.name} onClick={() => changeProject(group.id)}>
                <span className="group-dot" style={{ background: group.color }} /><span>{group.name}</span><b>{certificatesInProject(certificates, group.id).length}</b>
              </button>
              <button className="group-rename" aria-label={`${copy.renameGroup} ${group.name}`} onClick={() => setGroupEditTarget(group)}><Pencil size={13} /></button>
            </div>
          ))}
        </nav>
        <nav className="authority-navigation" aria-label={navigation.infrastructure}>
          <button className={`nav-item ${!settingsOpen && privateView === "roots" ? "active" : ""}`} aria-current={!settingsOpen && privateView === "roots" ? "page" : undefined} aria-label={management.roots} title={management.roots} onClick={() => setPrivateView("roots")}><ShieldCheck size={18} /><span>{management.roots}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <button className={`nav-item ${settingsOpen ? "active" : ""}`} aria-current={settingsOpen ? "page" : undefined} aria-label={copy.systemSettings} title={copy.systemSettings} onClick={() => navigate({ settings: "notifications", certificate: null })}><Settings size={18} /><span>{copy.systemSettings}</span></button>
          <div className="user-card"><span className="avatar">{(currentUsername[0] || "A").toUpperCase()}</span><span><strong>{currentUsername || copy.administrator}</strong><small>{copy.administrator}</small></span><button className="user-logout" aria-label={copy.logout} title={copy.logout} disabled={loggingOut} onClick={() => void handleLogout()}><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-content">
        {settingsOpen ? <>
          <header className="topbar"><div className="page-context"><div className="breadcrumb"><span>{copy.systemSettings}</span><ChevronRight size={13} /><b>{route.settings === "acme" ? acmeMessages(language).settings : copy.notificationSettings}</b></div></div><LanguageSwitcher language={language} onChange={changeLanguage} /></header>
          <div className="content-wrap settings-content">{loading ? <p role="status">{copy.loadingContent}</p> : <SystemSettingsPage tab={route.settings || "notifications"} setTab={settings => navigate({ settings })} copy={copy} language={language} settings={settings} setSettings={setSettings} onSave={() => void persistSettings()} onTest={() => void testNotification()} />}</div>
        </> : <>
        <header className="topbar">
          <div className="page-context"><div className="breadcrumb"><span>{privateView === "roots" ? navigation.infrastructure : navigation.certificates}</span><ChevronRight size={13} /><b>{privateView === "roots" ? management.roots : projectTitle}</b>{privateView === "services" && !needsProject && <><ChevronRight size={13} /><span>{scopeTitle}</span></>}</div></div>
          <div className="topbar-tools"><div className="top-actions scoped-actions">
            <button className="icon-button" aria-label={copy.refresh} onClick={() => void loadData(true)}><RefreshCw size={17} className={loading ? "spinning" : ""} /></button>
            {privateView === "services" && workspaceScope === "project" && (certificateScope === "public" ? <><button className="secondary-button" onClick={() => setUploadOpen(true)}><UploadCloud size={17} />{copy.uploadCertificate}</button><button className="primary-button" onClick={() => setAcmeOpen(true)}><FileKey2 size={17} />{management.publicIssue}</button></> : <><button className="secondary-button" onClick={() => setPrivateImportOpen(true)}><UploadCloud size={17} />{management.importService}</button><button className="primary-button" onClick={() => setPrivateIssueOpen(true)}><ShieldCheck size={17} />{management.privateIssue}</button></>)}
          </div><LanguageSwitcher language={language} onChange={changeLanguage} /></div>
        </header>

        <div className="content-wrap">
          {privateView === "services" && workspaceScope === "project" && <section className="metric-grid" aria-label={copy.overviewLabel}>
            <MetricCard label={copy.certTotal} value={metrics.total} note={navigation.currentRange} icon={<FileKey2 size={20} />} tone="indigo" />
            <MetricCard label={copy.healthy} value={metrics.healthy} note={metrics.total ? `${copy.healthRate} ${Math.round(metrics.healthy / metrics.total * 100)}%` : copy.noCertificates} icon={<CheckCircle2 size={20} />} tone="green" />
            <MetricCard label={copy.expiring30} value={metrics.expiring} note={metrics.expiring ? copy.renewSoon : copy.noRisk} icon={<AlertTriangle size={20} />} tone="amber" />
            <MetricCard label={copy.expired} value={metrics.expired} note={metrics.expired ? copy.actNow : copy.noExpired} icon={<LockKeyhole size={20} />} tone="red" />
          </section>}
          {privateView === "services" && workspaceScope === "project" && <div className="project-scope-header"><div className="certificate-type-tabs" role="group" aria-label={copy.certManagement}><button aria-pressed={certificateScope === "public"} className={certificateScope === "public" ? "active" : ""} onClick={() => changeScope("public")}><FileKey2 size={16} />{management.publicArea}<span>{publicCount}</span></button><button aria-pressed={certificateScope === "private"} className={certificateScope === "private" ? "active" : ""} onClick={() => changeScope("private")}><ShieldCheck size={16} />{management.privateArea}<span>{privateCount}</span></button></div></div>}
          {storage === "demo" && (
            <div className="demo-banner"><WifiOff size={16} /><span><strong>{copy.demoMode}</strong> · {copy.demoNote}</span></div>
          )}

          {privateView === "roots" ? <section className="panel private-roots-panel"><PrivateCaSettings language={language} onChanged={() => void loadData()} onManage={id => { navigate({ project: "all", type: "private", ca: id, view: "services", status: "all", certificate: null }); setSearch(""); }} /></section> : needsProject ? <section className="panel empty-state"><Folder size={34} /><h2>{loading ? "…" : groups.length ? navigation.chooseProject : navigation.noGroups}</h2>{!loading && <><p>{groups.length ? navigation.chooseProjectHint : navigation.noGroupsHint}</p><button className="primary-button" onClick={() => setGroupOpen(true)}><Plus size={16} />{copy.newGroup}</button></>}</section> : <>{certificateScope === "private" && authorityFilter !== "all" && <div className="active-ca-filter"><ShieldCheck size={16} /><span>{pkiMessages(language).ca}: <strong>{authorities.find(root => root.id === authorityFilter)?.subject.CN || authorityFilter}</strong></span><button onClick={() => setAuthorityFilter("all")} aria-label={navigation.clearCa}>{navigation.clearCa}<X size={14} /></button></div>}

          <section className="panel certificate-panel" aria-label={scopeTitle}>
            <div className="toolbar">
              <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></label>
              <div className="toolbar-actions">
                {certificateScope === "private" && <label className="select-box"><ShieldCheck size={15} /><select aria-label={pkiMessages(language).ca} value={authorityFilter} onChange={e => setAuthorityFilter(e.target.value)}><option value="all">{management.allRoots}</option>{authorities.map(root => <option value={root.id} key={root.id}>{root.subject.CN} · {root.id.slice(0, 8)}</option>)}</select></label>}
                <label className="select-box"><SlidersHorizontal size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{copy.allStatus}</option><option value="healthy">{copy.normalStatus}</option><option value="expiring">{copy.expiring30}</option><option value="expired">{copy.expired}</option></select></label>
                <span className="result-count">{copy.itemsPrefix} {filtered.length} {copy.itemsSuffix}</span>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th>{copy.certDomain}</th><th>{copy.project}</th><th>{copy.issuer}</th><th>{copy.expiryTime}</th><th>{copy.status}</th><th aria-label="actions" /></tr></thead>
                <tbody>
                  {filtered.map((certificate) => {
                    const status = statusOf(certificate);
                    return (
                      <tr key={certificate.id} onClick={() => setDetailTarget(certificate)}>
                        <td><div className="domain-cell"><span className="cert-icon"><ShieldCheck size={18} /></span><span><strong>{certificate.primaryDomain}</strong><small>{certificate.name} · {certificate.algorithm}</small></span></div></td>
                        <td><span className="project-tag"><i style={{ background: certificate.groupColor }} />{certificate.groupName}</span></td>
                        <td><span className="issuer">{certificate.issuer}</span></td>
                        <td><span className="date-cell"><strong>{formatDate(certificate.expiresAt, language)}</strong><small>{copy.issuedOn} {formatDate(certificate.validFrom, language)}</small></span></td>
                        <td><span className={`status-badge ${status.tone}`}><i />{statusLabel(certificate, copy)}</span></td>
                        <td><div className="row-actions"><button className="row-menu edit" aria-label={`${copy.edit} ${certificate.primaryDomain}`} onClick={(event) => { event.stopPropagation(); setEditTarget(certificate); }}><Pencil size={15} /></button><button className="row-menu" aria-label={`${copy.delete} ${certificate.primaryDomain}`} onClick={(event) => { event.stopPropagation(); setDeleteTarget(certificate); setDeleteConfirmed(false); }}><Trash2 size={16} /></button></div></td>
                      </tr>
                    );
                  })}
                  {!loading && !filtered.length && <tr><td colSpan={6}><div className="empty-state"><ShieldCheck size={34} /><h3>{copy.noResults}</h3><p>{copy.noResultsHint}</p><button className="primary-button" onClick={() => certificateScope === "private" ? setPrivateImportOpen(true) : setUploadOpen(true)}><Plus size={16} />{certificateScope === "private" ? management.importService : copy.uploadCertificate}</button></div></td></tr>}
                </tbody>
              </table>
            </div>
          </section></>}
        </div>
        </>}
      </main>

      {uploadOpen && <UploadModal copy={copy} groups={groups} initialGroup={groupFilter} onClose={() => setUploadOpen(false)} onSuccess={(message) => { setUploadOpen(false); showToast("success", message); void loadData(); }} onError={(message) => showToast("error", message)} />}
      {editTarget && <EditCertificateModal copy={copy} certificate={editTarget} groups={groups} onClose={() => setEditTarget(null)} onUpdated={(certificate) => { setEditTarget(null); setCertificates((items) => items.map((item) => item.id === certificate.id ? certificate : item)); showToast("success", copy.updated); void loadData(); }} onError={(message) => showToast("error", message)} />}
      {acmeOpen && <AcmeModal language={language} groups={groups} initialGroup={groupFilter} onClose={() => { setAcmeOpen(false); void loadData(); }} onOpenCertificate={(id) => { void loadData().then((items) => { const certificate = items?.find((item) => item.id === id); if (certificate) { setAcmeOpen(false); setDetailTarget(certificate); } }); }} onConfigure={() => { setAcmeOpen(false); navigate({ settings: "acme", certificate: null }); }} />}
      {privateIssueOpen && <PrivateIssueModal language={language} groups={groups} initialGroup={groupFilter} initialAuthority={authorityFilter} onClose={() => setPrivateIssueOpen(false)} onConfigure={() => { setPrivateIssueOpen(false); setPrivateView("roots"); }} onIssued={(id) => { setPrivateIssueOpen(false); showToast("success", pkiMessages(language).issued); void loadData().then(items => { const certificate = items?.find(item => item.id === id); if (certificate) setDetailTarget(certificate); }); }} />}
      {privateImportOpen && <PrivateImportModal language={language} groups={groups} initialGroup={groupFilter} initialAuthority={authorityFilter} onClose={() => setPrivateImportOpen(false)} onImported={id => { setPrivateImportOpen(false); showToast("success", management.imported); void loadData().then(items => { const certificate = items?.find(item => item.id === id); if (certificate) setDetailTarget(certificate); }); }} />}
      {groupOpen && <GroupModal copy={copy} onClose={() => setGroupOpen(false)} onCreated={(group) => { setGroupOpen(false); setGroups((items) => [...items, group]); changeProject(group.id); showToast("success", copy.groupCreated); }} onError={(message) => showToast("error", message)} />}
      {groupEditTarget && <EditGroupModal copy={copy} group={groupEditTarget} onClose={() => setGroupEditTarget(null)} onDelete={() => { setGroupDeleteTarget(groupEditTarget); setGroupEditTarget(null); }} onUpdated={(group) => { setGroupEditTarget(null); setGroups((items) => items.map((item) => item.id === group.id ? { ...item, ...group } : item)); setCertificates((items) => items.map((item) => item.groupId === group.id ? { ...item, groupName: group.name } : item)); setEditTarget((current) => current?.groupId === group.id ? { ...current, groupName: group.name } : current); showToast("success", copy.groupUpdated); }} onError={(message) => showToast("error", message)} />}
      {groupDeleteTarget && <DeleteGroupModal copy={copy} group={groupDeleteTarget} onClose={() => setGroupDeleteTarget(null)} onDeleted={() => { const deletedId = groupDeleteTarget.id; setGroupDeleteTarget(null); setGroups((items) => items.filter((item) => item.id !== deletedId)); if (groupFilter === deletedId) navigate({ project: "all", ca: "all", certificate: null }, true); showToast("success", copy.groupDeleted); }} onError={(message) => showToast("error", message)} />}
      {detailTarget && <DetailDrawer key={`${detailTarget.id}:${detailTarget.fingerprint}`} copy={copy} language={language} certificate={detailTarget} onIssued={() => void loadData()} onClose={() => setDetailTarget(null)} onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null); }} onDelete={() => { setDeleteTarget(detailTarget); setDeleteConfirmed(false); setDetailTarget(null); }} onToast={showToast} />}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}>
          <div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <button className="modal-close" onClick={() => setDeleteTarget(null)}><X size={19} /></button>
            <span className="danger-icon"><Trash2 size={22} /></span><h2 id="delete-title">{copy.deleteTitle}</h2>
            <p>{copy.deleteWarning}</p>
            {deleteTarget.privateCa && <p>{pkiMessages(language).deleteService}</p>}
            <div className="delete-cert"><ShieldCheck size={18} /><span><strong>{deleteTarget.primaryDomain}</strong><small>{deleteTarget.groupName} · {deleteTarget.issuer}</small></span></div>
            <label className="confirm-check"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /><span className="fake-check"><Check size={13} /></span><span>{copy.deleteConfirm}</span></label>
            <div className="modal-actions"><button className="ghost-button" onClick={() => setDeleteTarget(null)}>{copy.cancel}</button><button className="danger-button" disabled={!deleteConfirmed} onClick={() => void handleDelete()}>{copy.confirmDelete}</button></div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span>{toast.text}</span></div>}
    </div>
  );
}

function MetricCard({ label, value, note, icon, tone }: { label: string; value: number; note: string; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><span className={`metric-icon ${tone}`}>{icon}</span></div>;
}

function UploadModal({ copy, groups, initialGroup, onClose, onSuccess, onError }: { copy: Messages; groups: Group[]; initialGroup: string; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [privateKeyFile, setPrivateKeyFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    if (certificateFile) form.set("certificateFile", certificateFile);
    if (privateKeyFile) form.set("privateKeyFile", privateKeyFile);
    try {
      const response = await authenticatedFetch("/api/certificates", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok) return onError(json.error || copy.operationFailed);
      onSuccess(`${json.data.primaryDomain} ${copy.parsedSaved}`);
    } catch { onError(copy.uploadingFailed); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal upload-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}><X size={19} /></button>
        <div className="modal-title-row"><span className="title-icon"><UploadCloud size={20} /></span><div><h2>{copy.uploadTitle}</h2><p>{copy.uploadSubtitle}</p></div></div>
        <div className="mode-tabs"><button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>{copy.fileUpload}</button><button type="button" className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}>{copy.pasteContent}</button></div>
        <div className="form-grid two"><label><span>{copy.certName} <em>{copy.optional}</em></span><input name="name" placeholder={copy.certNamePlaceholder} /></label><label><span>{copy.project} <b>*</b></span><select name="groupId" required defaultValue={groups.some(group => group.id === initialGroup) ? initialGroup : groups[0]?.id || ""}><option value="" disabled>{copy.selectGroup}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
        {mode === "file" ? (
          <div className="file-grid">
            <FileDrop label={copy.certFile} hint={copy.certFileHint} file={certificateFile} accept=".pem,.crt,.cer" required clickReplace={copy.clickReplace} onChange={setCertificateFile} />
            <FileDrop label={copy.keyFile} hint={copy.keyFileHint} file={privateKeyFile} accept=".key,.pem" clickReplace={copy.clickReplace} onChange={setPrivateKeyFile} />
          </div>
        ) : (
          <div className="paste-grid"><label><span>{copy.certContent} <b>*</b></span><textarea name="certificateText" required placeholder={`-----BEGIN CERTIFICATE-----\n${copy.pasteCert}\n-----END CERTIFICATE-----`} /></label><label><span>{copy.keyContent} <em>{copy.optional}</em></span><textarea name="privateKeyText" placeholder={`-----BEGIN PRIVATE KEY-----\n${copy.pasteKey}\n-----END PRIVATE KEY-----`} /></label></div>
        )}
        <div className="security-note"><LockKeyhole size={16} /><span>{copy.securityNote}</span></div>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{copy.cancel}</button><button className="primary-button" disabled={submitting}>{submitting ? <><RefreshCw className="spinning" size={16} />{copy.parsing}</> : <><UploadCloud size={16} />{copy.parseUpload}</>}</button></div>
      </form>
    </div>
  );
}

function FileDrop({ label, hint, file, accept, required, clickReplace, onChange }: { label: string; hint: string; file: File | null; accept: string; required?: boolean; clickReplace: string; onChange: (file: File | null) => void }) {
  return <label className={`file-drop ${file ? "has-file" : ""}`}><input type="file" accept={accept} required={required && !file} onChange={(event) => onChange(event.target.files?.[0] || null)} /><span className="file-drop-icon">{file ? <CheckCircle2 size={22} /> : <FileKey2 size={22} />}</span><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB · ${clickReplace}` : hint}</small></label>;
}

function EditCertificateModal({ copy, certificate, groups, onClose, onUpdated, onError }: { copy: Messages; certificate: Certificate; groups: Group[]; onClose: () => void; onUpdated: (certificate: Certificate) => void; onError: (message: string) => void }) {
  const [name, setName] = useState(certificate.name);
  const [groupId, setGroupId] = useState(certificate.groupId);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/certificates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: certificate.id, name, groupId }),
      });
      const json = await response.json();
      if (!response.ok) return onError(json.error || copy.operationFailed);
      onUpdated(json.data);
    } catch {
      onError(copy.operationFailed);
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal small-modal edit-cert-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}><X size={19} /></button><div className="modal-title-row"><span className="title-icon"><Pencil size={19} /></span><div><h2>{copy.editTitle}</h2><p>{copy.editDesc}</p></div></div><div className="edit-cert-domain"><ShieldCheck size={17} /><strong>{certificate.primaryDomain}</strong></div><label><span>{copy.certName} <b>*</b></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={180} required /></label><label><span>{copy.project} <b>*</b></span><select value={groupId} onChange={(event) => setGroupId(event.target.value)} required>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{copy.cancel}</button><button className="primary-button" disabled={saving || !name.trim()}>{saving ? copy.creating : copy.saveChanges}</button></div></form></div>;
}

function SystemSettingsPage({ tab, setTab, copy, language, settings, setSettings, onSave, onTest }: { tab: SettingsTab; setTab: (tab: SettingsTab) => void; copy: Messages; language: Language; settings: NotificationSettings; setSettings: React.Dispatch<React.SetStateAction<NotificationSettings>>; onSave: () => void; onTest: () => void }) {
  const update = <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  function onTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: SettingsTab = event.key === "Home" ? "notifications" : event.key === "End" ? "acme" : tab === "acme" ? "notifications" : "acme";
    event.currentTarget.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus();
    setTab(next);
  }
  return (
    <section className="panel settings-page" aria-label={copy.systemSettings}>
        <div className="settings-page-tabs" role="tablist" aria-label={copy.systemSettings} onKeyDown={onTabKey}>
          <button id="settings-tab-notifications" role="tab" aria-selected={tab === "notifications"} aria-controls="settings-panel-notifications" tabIndex={tab === "notifications" ? 0 : -1} className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><BellRing size={17} />{copy.notificationSettings}</button>
          <button id="settings-tab-acme" role="tab" aria-selected={tab === "acme"} aria-controls="settings-panel-acme" tabIndex={tab === "acme" ? 0 : -1} className={tab === "acme" ? "active" : ""} onClick={() => setTab("acme")}><FileKey2 size={17} />{acmeMessages(language).settings}</button>
        </div>
        <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0} className="settings-page-body">
        {tab === "acme" ? <AcmeSettingsPanel language={language} /> : (
          <div className="settings-pane notification-pane">
            <div className="settings-pane-heading"><h3>{copy.notificationTitle}</h3><p>{copy.reminderDesc}</p></div>
            <div className="reminder-timeline"><span>{copy.early}</span>{[15, 7, 3, 1].map((day) => <b key={day}>{day}</b>)}<i /><span>{copy.expiryDay}</span></div>
            <ChannelCard icon={<MessageSquare size={19} />} title={copy.dingtalk} description={copy.dingtalkDesc} enabled={settings.dingtalkEnabled} onToggle={(value) => update("dingtalkEnabled", value)}><label><span>{copy.webhook}</span><input value={settings.dingtalkWebhook} onChange={(event) => update("dingtalkWebhook", event.target.value)} placeholder="https://oapi.dingtalk.com/robot/send?..." spellCheck={false} /></label><SecretField id="dingtalk-secret" label={copy.signSecret} hint={copy.signSecretHint} value={settings.dingtalkSecret} onChange={(value) => update("dingtalkSecret", value)} placeholder="SEC..." showLabel={copy.showSecret} hideLabel={copy.hideSecret} /></ChannelCard>
            <ChannelCard icon={<Send size={18} />} title={copy.feishu} description={copy.feishuDesc} enabled={settings.feishuEnabled} onToggle={(value) => update("feishuEnabled", value)}><label><span>{copy.webhook}</span><input value={settings.feishuWebhook} onChange={(event) => update("feishuWebhook", event.target.value)} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." spellCheck={false} /></label><SecretField id="feishu-secret" label={copy.signSecret} hint={copy.signSecretHint} value={settings.feishuSecret} onChange={(value) => update("feishuSecret", value)} showLabel={copy.showSecret} hideLabel={copy.hideSecret} /></ChannelCard>
            <ChannelCard icon={<Mail size={19} />} title={copy.email} description={copy.emailDesc} enabled={settings.emailEnabled} onToggle={(value) => update("emailEnabled", value)}>
              <div className="form-grid three"><label><span>{copy.smtpHost}</span><input value={settings.smtpHost} onChange={(event) => update("smtpHost", event.target.value)} placeholder="smtp.example.com" /></label><label><span>{copy.port}</span><input type="number" value={settings.smtpPort} onChange={(event) => update("smtpPort", Number(event.target.value))} /></label><label><span>{copy.sender}</span><input value={settings.emailFrom} onChange={(event) => update("emailFrom", event.target.value)} placeholder="ssl@example.com" /></label></div>
              <div className="form-grid two"><label><span>{copy.smtpUser}</span><input value={settings.smtpUser} onChange={(event) => update("smtpUser", event.target.value)} /></label><SecretField id="smtp-password" label={copy.smtpPassword} value={settings.smtpPassword} onChange={(value) => update("smtpPassword", value)} showLabel={copy.showSecret} hideLabel={copy.hideSecret} /></div>
              <label><span>{copy.recipients} <em>{copy.recipientsHint}</em></span><input value={settings.emailRecipients} onChange={(event) => update("emailRecipients", event.target.value)} placeholder="ops@example.com, admin@example.com" /></label>
            </ChannelCard>
          </div>
        )}
        {tab === "notifications" && <div className="settings-page-actions"><button className="secondary-button" onClick={onTest}><Send size={16} />{copy.sendTest}</button><button className="primary-button" onClick={onSave}>{copy.saveSettings}</button></div>}
        </div>
    </section>
  );
}

function SecretField({ id, label, hint, value, onChange, placeholder, showLabel, hideLabel }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder?: string; showLabel: string; hideLabel: string }) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? hideLabel : showLabel;
  return (
    <div className="secret-field stacked-field">
      <label htmlFor={id}><span>{label} {hint && <em>{hint}</em>}</span></label>
      <div className="secret-input-wrap">
        <input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={toggleLabel} title={toggleLabel} aria-pressed={visible}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function ChannelCard({ icon, title, description, enabled, onToggle, children }: { icon: React.ReactNode; title: string; description: string; enabled: boolean; onToggle: (value: boolean) => void; children: React.ReactNode }) {
  return <div className={`channel-card ${enabled ? "enabled" : ""}`}><div className="channel-head"><span className="channel-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span><button className={`switch ${enabled ? "on" : ""}`} onClick={() => onToggle(!enabled)} aria-label={title}><i /></button></div>{enabled && <div className="channel-fields">{children}</div>}</div>;
}

function GroupModal({ copy, onClose, onCreated, onError }: { copy: Messages; onClose: () => void; onCreated: (group: Group) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); const response = await authenticatedFetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); const json = await response.json(); setSaving(false); if (!response.ok) return onError(json.error || copy.operationFailed); onCreated(json.data); }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal small-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}><X size={19} /></button><span className="title-icon"><FolderPlus size={20} /></span><h2>{copy.groupTitle}</h2><p>{copy.groupDesc}</p><label><span>{copy.groupName}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder={copy.groupPlaceholder} /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{copy.cancel}</button><button className="primary-button" disabled={saving || !name.trim()}>{saving ? copy.creating : copy.createGroup}</button></div></form></div>;
}

function EditGroupModal({ copy, group, onClose, onDelete, onUpdated, onError }: { copy: Messages; group: Group; onClose: () => void; onDelete: () => void; onUpdated: (group: Group) => void; onError: (message: string) => void }) {
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const certificateCount = group.count ?? 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/groups", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: group.id, name }) });
      const json = await response.json();
      if (!response.ok) return onError(json.error || copy.operationFailed);
      onUpdated(json.data);
    } catch {
      onError(copy.operationFailed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal small-modal edit-group-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}><X size={19} /></button>
        <span className="title-icon"><Pencil size={19} /></span>
        <h2>{copy.editGroupTitle}</h2>
        <p>{copy.editGroupDesc}</p>
        <label><span>{copy.groupName}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <div className={`group-danger-zone ${certificateCount > 0 ? "is-blocked" : ""}`}>
          <div className="group-danger-message">
            <span className="group-danger-icon"><Trash2 size={16} /></span>
            <span><strong>{copy.deleteGroup}</strong><small>{certificateCount > 0 ? copy.groupDeleteBlocked.replace("{count}", String(certificateCount)) : copy.groupDeleteHint}</small></span>
          </div>
          <button type="button" className="group-delete-button" disabled={certificateCount > 0} onClick={onDelete}>{copy.deleteGroup}</button>
        </div>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{copy.cancel}</button><button className="primary-button" disabled={saving || !name.trim() || name.trim() === group.name}>{saving ? copy.creating : copy.saveChanges}</button></div>
      </form>
    </div>
  );
}

function DeleteGroupModal({ copy, group, onClose, onDeleted, onError }: { copy: Messages; group: Group; onClose: () => void; onDeleted: () => void; onError: (message: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  async function confirmDelete() {
    setDeleting(true);
    try {
      const response = await authenticatedFetch("/api/groups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: group.id }) });
      const json = await response.json();
      if (!response.ok) return onError(json.error || copy.operationFailed);
      onDeleted();
    } catch {
      onError(copy.operationFailed);
    } finally {
      setDeleting(false);
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-group-title"><button className="modal-close" onClick={onClose}><X size={19} /></button><span className="danger-icon"><Trash2 size={22} /></span><h2 id="delete-group-title">{copy.deleteGroupTitle}</h2><p>{copy.deleteGroupWarning}</p><div className="delete-cert"><Folder size={18} /><span><strong>{group.name}</strong><small>{copy.noCertificates}</small></span></div><div className="modal-actions"><button className="ghost-button" onClick={onClose}>{copy.cancel}</button><button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? copy.deleting : copy.confirmDeleteGroup}</button></div></div></div>;
}

function DetailDrawer({ copy, language, certificate, onClose, onEdit, onDelete, onToast, onIssued }: { copy: Messages; language: Language; certificate: Certificate; onClose: () => void; onEdit: () => void; onDelete: () => void; onToast: (type: "success" | "error", text: string) => void; onIssued: () => void }) {
  const status = statusOf(certificate);
  const [contents, setContents] = useState<CertificateExportContents | null>(null);
  const [contentAction, setContentAction] = useState<string | null>(null);

  async function copyValue(value: string) {
    try {
      await copyText(value);
      onToast("success", copy.copied);
    } catch {
      onToast("error", copy.copyFailed);
    }
  }

  async function loadContents() {
    if (contents) return contents;
    const response = await authenticatedFetch("/api/certificates/contents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: certificate.id }), cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || copy.contentUnavailable);
    setContents(json.data);
    return json.data as CertificateExportContents;
  }

  async function copyMaterial(key: keyof CertificateExportContents) {
    setContentAction(`copy-${key}`);
    try {
      const data = await loadContents();
      if (!data[key]) throw new Error(copy.contentUnavailable);
      await copyValue(data[key]);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : copy.contentUnavailable);
    } finally {
      setContentAction(null);
    }
  }

  async function downloadMaterial(key: keyof CertificateExportContents) {
    setContentAction(`download-${key}`);
    try {
      const data = await loadContents();
      if (!data[key]) throw new Error(copy.contentUnavailable);
      const blob = new Blob([data[key]], { type: "application/x-pem-file;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = certificateExportNames(certificate.primaryDomain)[key];
      anchor.click();
      URL.revokeObjectURL(url);
      onToast("success", copy.downloaded);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : copy.contentUnavailable);
    } finally {
      setContentAction(null);
    }
  }

  async function downloadKeyPair() {
    setContentAction("download-zip");
    try {
      const response = await authenticatedFetch("/api/certificates/contents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: certificate.id, format: "zip" }), cache: "no-store" });
      if (!response.ok) {
        const json = await response.json();
        throw new Error(json.error || copy.contentUnavailable);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = certificateExportNames(certificate.primaryDomain).archive;
      anchor.click();
      URL.revokeObjectURL(url);
      onToast("success", copy.downloaded);
    } catch (error) {
      onToast("error", error instanceof Error ? error.message : copy.contentUnavailable);
    } finally {
      setContentAction(null);
    }
  }

  const materialRows: Array<{ key: keyof CertificateExportContents; label: string; disabled?: boolean }> = [
    { key: "certificatePem", label: `${copy.certContent} (.pem)` },
    { key: "privateKey", label: `${copy.keyContent} (.key)`, disabled: !certificate.hasPrivateKey },
  ];

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="detail-drawer">
        <button className="modal-close" onClick={onClose}><X size={19} /></button>
        <div className="drawer-hero"><span className="large-cert-icon"><ShieldCheck size={27} /></span><span className={`status-badge ${status.tone}`}><i />{statusLabel(certificate, copy)}</span><h2>{certificate.primaryDomain}</h2><p>{certificate.name}</p></div>
        <div className="detail-section"><h3>{copy.certInfo}</h3><DetailRow label={copy.issuer} value={certificate.issuer} /><DetailRow label={copy.project} value={certificate.groupName || "—"} /><DetailRow label={copy.algorithm} value={certificate.algorithm} /><DetailRow label={copy.validFrom} value={formatDate(certificate.validFrom, language)} /><DetailRow label={copy.expiryDate} value={formatDate(certificate.expiresAt, language)} /><DetailRow label={copy.privateKeyStatus} value={certificate.hasPrivateKey ? copy.keyStored : copy.keyMissing} /></div>
        {certificate.privateCa ? <PrivateCertificatePanel language={language} certificate={certificate} onChanged={onIssued} /> : <CertificateAcmePanel language={language} certificateId={certificate.id} onIssued={onIssued} />}
        <div className="detail-section"><h3>{certificate.privateCa ? pkiMessages(language).ips : copy.domains}</h3><div className="domain-list">{certificate.domains.map((domain) => <span key={domain}>{domain}<button onClick={() => void copyValue(domain)} aria-label={`${copy.copyContent} ${domain}`}><Copy size={13} /></button></span>)}</div></div>
        <div className="detail-section"><h3>{copy.fingerprint}</h3><button className="fingerprint" onClick={() => void copyValue(certificate.fingerprint)}><code>{certificate.fingerprint}</code><Copy size={14} /></button></div>
        <div className="detail-section certificate-material-section">
          <h3>{copy.certificateFiles}</h3>
          <div className="certificate-material-list">
            {materialRows.map((item) => (
              <div className={`certificate-material-item ${item.disabled ? "is-disabled" : ""}`} key={item.key}>
                <div className="certificate-material-info">
                  <span className="certificate-material-icon"><FileKey2 size={16} /></span>
                  <span className="certificate-material-copy"><strong>{item.label}</strong>{item.disabled && <small>{copy.keyMissing}</small>}</span>
                </div>
                <div className="certificate-material-actions">
                  <button className="certificate-material-action" disabled={item.disabled || contentAction !== null} onClick={() => void copyMaterial(item.key)} aria-label={`${copy.copyContent}：${item.label}`}>
                    {contentAction === `copy-${item.key}` ? <RefreshCw className="spinning" size={13} /> : <Copy size={13} />}<span>{copy.copyContent}</span>
                  </button>
                  <button className="certificate-material-action" disabled={item.disabled || contentAction !== null} onClick={() => void downloadMaterial(item.key)} aria-label={`${copy.download}：${item.label}`}>
                    {contentAction === `download-${item.key}` ? <RefreshCw className="spinning" size={13} /> : <Download size={13} />}<span>{copy.download}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="drawer-actions"><button className="danger-text-button" onClick={onDelete}><Trash2 size={16} />{copy.delete}</button><span className="drawer-primary-actions"><button className="secondary-button" onClick={onEdit}><Pencil size={15} />{copy.edit}</button><button className="primary-button" onClick={() => void downloadKeyPair()} disabled={contentAction !== null || !certificate.hasPrivateKey}>{contentAction === "download-zip" ? <RefreshCw className="spinning" size={15} /> : <Download size={15} />}{copy.exportCertificate}</button></span></div>
      </aside>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>; }
