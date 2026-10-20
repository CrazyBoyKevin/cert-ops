"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FileKey2, Plus, RefreshCw, Settings, ShieldCheck, X } from "lucide-react";
import { messages, type Language } from "@/lib/i18n";
import { acmeMessages } from "@/lib/acme-i18n";
import type { AcmeOrder, PublicAcmeSettings, PublicAliyunCredential } from "@/lib/acme-types";
import type { Group } from "@/lib/types";
import { copyText } from "@/lib/clipboard";
import { loginHref } from "@/lib/app-route";

async function api(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, { cache: "no-store", ...(body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401) { window.location.replace(loginHref(window.location.pathname + window.location.search)); throw new Error("UNAUTHORIZED"); }
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "SERVICE_UNAVAILABLE");
  return json;
}
function errorText(error: unknown, language: Language) {
  const code = error instanceof Error ? error.message : "SERVICE_UNAVAILABLE";
  const copy = acmeMessages(language);
  return copy[code as keyof typeof copy] || `${messages[language].operationFailed} (${code})`;
}
const EMPTY: PublicAcmeSettings = { email: "", termsAgreed: false, credentialsConfigured: false, credentials: [] };

export function AcmeSettingsPanel({ language }: { language: Language }) {
  const copy = acmeMessages(language), common = messages[language];
  const [config, setConfig] = useState(EMPTY);
  const [editing, setEditing] = useState<PublicAliyunCredential | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [zone, setZone] = useState("");
  const [testCredentialId, setTestCredentialId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: unknown; text?: string } | null>(null);
  useEffect(() => {
    let active = true;
    api("/api/acme/settings").then((json) => { if (active) { setConfig(json.data); setLoaded(true); } })
      .catch((error) => { if (active) setResult({ error }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setResult(null);
    try {
      const json = await api("/api/acme/settings", { email: config.email, termsAgreed: config.termsAgreed }, "PUT");
      setConfig(json.data); setResult({ text: copy.saved });
    } catch (error) { setResult({ error }); } finally { setBusy(false); }
  }
  async function testDns() {
    setBusy(true); setResult(null);
    try { await api("/api/acme/dns-test", { zone, credentialId: testCredentialId }); setResult({ text: copy.testPassed }); }
    catch (error) { setResult({ error }); } finally { setBusy(false); }
  }
  async function refreshCredentials() {
    const json = await api("/api/acme/credentials");
    setConfig((previous) => ({ ...previous, credentials: json.data, credentialsConfigured: json.data.length > 0 }));
  }
  function openEditor(credential: PublicAliyunCredential | null) {
    setEditing(credential); setCredentialName(credential?.name || ""); setAccessKeyId(""); setAccessKeySecret(""); setEditorOpen(true); setResult(null);
  }
  function closeEditor() {
    setEditorOpen(false); setEditing(null); setCredentialName(""); setAccessKeyId(""); setAccessKeySecret("");
  }
  async function saveCredential(event: FormEvent) {
    event.preventDefault(); setBusy(true); setResult(null);
    try {
      await api("/api/acme/credentials", { id: editing?.id, name: credentialName, accessKeyId, accessKeySecret }, editing ? "PATCH" : "POST");
      closeEditor(); await refreshCredentials(); setResult({ text: copy.credentialSaved });
    } catch (error) { setResult({ error }); } finally { setBusy(false); }
  }
  async function deleteCredential(credential: PublicAliyunCredential) {
    if (!window.confirm(`${copy.deleteCredentialConfirm}\n${credential.name}`)) return;
    setBusy(true); setResult(null);
    try {
      await api("/api/acme/credentials", { id: credential.id, confirmed: true }, "DELETE");
      if (testCredentialId === credential.id) setTestCredentialId("");
      if (editing?.id === credential.id) closeEditor();
      await refreshCredentials(); setResult({ text: copy.credentialDeleted });
    } catch (error) { setResult({ error }); } finally { setBusy(false); }
  }
  return <div className="settings-pane acme-form">
    <div className="settings-pane-heading"><h3>Let’s Encrypt</h3></div>
    {result && <div className={`acme-notice ${result.error ? "error" : "success"}`} role="status">{result.error ? errorText(result.error, language) : result.text}</div>}
    {loading ? <p><RefreshCw size={16} className="spinning" /> {common.loadingContent}</p> : loaded && <>
      <form className="acme-form" onSubmit={save}>
      <label><span>{copy.email}</span><input type="email" required maxLength={254} value={config.email} onChange={(e) => setConfig({ ...config, email: e.target.value })} placeholder="ops@example.com" /></label>
      <label className="acme-check"><input type="checkbox" checked={config.termsAgreed} onChange={(e) => setConfig({ ...config, termsAgreed: e.target.checked })} /><span>{copy.terms} <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">{copy.agreement} ↗</a></span></label>
      <div className="acme-actions"><button className="primary-button" disabled={busy}>{busy && <RefreshCw size={14} className="spinning" />}{common.saveSettings}</button></div>
      </form>
      <section className="acme-credentials" aria-labelledby="aliyun-credentials-title">
        <div className="acme-credentials-heading"><h3 id="aliyun-credentials-title">{copy.credentialsTitle}</h3><button type="button" className="secondary-button" disabled={busy} onClick={() => openEditor(null)}><Plus size={14} />{copy.addCredential}</button></div>
        <p>{copy.credentialBindingHint}</p>
        {!config.credentials.length && <p className="acme-credentials-empty">{copy.noCredentials}</p>}
        <div className="acme-credential-list">{config.credentials.map((credential) => <article className="acme-credential" key={credential.id}>
          <div><strong>{credential.name}</strong><span>{credential.accessKeyHint} · {copy.credentialUsage.replace("{count}", String(credential.orderCount))}</span></div>
          <div className="acme-credential-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => openEditor(credential)}>{common.edit}</button><button type="button" className="danger-text-button" disabled={busy || credential.orderCount > 0} title={credential.orderCount ? copy.CREDENTIAL_IN_USE : undefined} onClick={() => void deleteCredential(credential)}>{common.delete}</button></div>
        </article>)}</div>
        {editorOpen && <form className="acme-form acme-credential-editor" onSubmit={saveCredential}>
          <h4>{editing ? copy.editCredential : copy.addCredential}</h4>
          <label><span>{copy.credentialName}</span><input required maxLength={100} value={credentialName} onChange={(e) => setCredentialName(e.target.value)} placeholder={copy.credentialNamePlaceholder} /></label>
          <div className="form-grid two">
            <label><span>AccessKey ID</span><input autoComplete="off" spellCheck={false} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} required={!editing || Boolean(accessKeySecret)} maxLength={256} placeholder={editing?.accessKeyHint || "LTAI…"} /></label>
            <label><span>AccessKey Secret</span><input type="password" autoComplete="new-password" value={accessKeySecret} onChange={(e) => setAccessKeySecret(e.target.value)} required={!editing || Boolean(accessKeyId)} maxLength={256} /></label>
          </div>
          <p>{copy.credentialsHint}</p>{editing && <p>{copy.rotationHint}</p>}
          <div className="acme-credential-actions"><button type="button" className="ghost-button" disabled={busy} onClick={closeEditor}>{common.cancel}</button><button className="primary-button" disabled={busy}>{common.saveChanges}</button></div>
        </form>}
      </section>
      <div className="acme-form acme-credential-test">
        <label><span>{copy.selectCredential}</span><select value={testCredentialId} onChange={(e) => setTestCredentialId(e.target.value)}><option value="" disabled>{copy.selectCredential}</option>{config.credentials.map((credential) => <option value={credential.id} key={credential.id}>{credential.name} · {credential.accessKeyHint}</option>)}</select></label>
        <div className="acme-test"><label><span>{copy.zone}</span><input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="example.com" /></label><button className="secondary-button" type="button" disabled={busy || !config.credentials.some((item) => item.id === testCredentialId) || !zone.trim()} onClick={() => void testDns()}>{copy.test}</button></div>
      </div>
    </>}
  </div>;
}

export function AcmeModal({ language, groups, initialGroup, onClose, onConfigure, onOpenCertificate }: {
  language: Language; groups: Group[]; initialGroup: string; onClose: () => void; onConfigure: () => void; onOpenCertificate: (id: string) => void;
}) {
  const copy = acmeMessages(language), common = messages[language];
  const [tab, setTab] = useState<"new" | "orders">("new");
  const [orders, setOrders] = useState<AcmeOrder[]>([]);
  const [credentials, setCredentials] = useState<PublicAliyunCredential[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [dnsProvider, setDnsProvider] = useState<"aliyun" | "manual">("aliyun");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<AcmeOrder | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [pendingCleanup, setPendingCleanup] = useState(0);
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [domains, setDomains] = useState("");
  const [groupId, setGroupId] = useState(groups.some((g) => g.id === initialGroup) ? initialGroup : groups[0]?.id || "");
  const [environment, setEnvironment] = useState("staging");
  const refresh = useCallback(async () => {
    const json = await api(`/api/acme/orders?scope=pending&page=${page}`);
    setOrders(json.data); setPendingCleanup(json.pendingCleanup); setPagination(json); setPage(json.page);
  }, [page]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [settings, list, tracked] = await Promise.all([api("/api/acme/settings"), api(`/api/acme/orders?scope=pending&page=${page}`), trackedId ? api(`/api/acme/orders?id=${trackedId}`) : Promise.resolve(null)]);
        if (active) {
          setConfigured(settings.data.termsAgreed && Boolean(settings.data.email)); setCredentials(settings.data.credentials);
          setOrders(list.data); setPendingCleanup(list.pendingCleanup); setPagination(list); setPage(list.page);
          if (tracked?.data[0]?.certificateId) { setCompleted(tracked.data[0]); setTrackedId(null); }
        }
      } catch (error) { if (active) setError(error); } finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [page, trackedId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await api("/api/acme/orders", { name, zone, domains, groupId, environment, dnsProvider, autoRenew: false, credentialId: dnsProvider === "manual" ? null : credentialId });
      setTrackedId(result.data.id); setCompleted(null); setPage(1); setTab("orders");
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function change(order: AcmeOrder, action: "renew" | "autoRenew" | "remove" | "checkDns" | "continue") {
    if (action === "renew" && !window.confirm(order.dnsProvider === "manual" ? copy.manualRetryConfirm : copy.retryConfirm)) return;
    if (action === "remove" && !window.confirm(copy.removeConfirm + (order.dnsProvider === "manual" ? `\n${copy.manualCleanup}` : ""))) return;
    setBusy(true); setError(null);
    try {
      await api("/api/acme/orders", { id: order.id, action, autoRenew: !order.autoRenew, confirmed: true }, action === "remove" ? "DELETE" : "PATCH");
      if (action !== "remove") { setTrackedId(order.id); setCompleted(null); }
      else if (trackedId === order.id) setTrackedId(null);
      await refresh();
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal acme-modal" role="dialog" aria-modal="true" aria-labelledby="acme-title">
      <button className="modal-close" onClick={onClose} aria-label={common.done}><X size={19} /></button>
      <div className="modal-title-row"><span className="title-icon"><FileKey2 size={21} /></span><div><h2 id="acme-title">{copy.title}</h2></div></div>
      <div className="mode-tabs"><button className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>{copy.newOrder}</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>{copy.orders} · {pagination.total}</button></div>
      {error != null && <div className="acme-notice error" role="alert">{errorText(error, language)}</div>}
      {pendingCleanup > 0 && <div className="acme-notice">{copy.cleanup}</div>}
      {loading ? <p>{common.loadingContent}</p> : tab === "new" ? <form className="acme-form" onSubmit={submit}>
        {!configured && <div className="acme-notice"><p>{copy.missing}</p><button type="button" className="secondary-button" onClick={onConfigure}><Settings size={14} />{copy.configure}</button></div>}
        <div className="form-grid two"><label><span>{common.certName} <em>{common.optional}</em></span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={180} placeholder={common.certNamePlaceholder} /></label>
          <label><span>{common.project}</span><select required value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="" disabled>{common.selectGroup}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
        <label><span>{copy.dnsMethod}</span><select value={dnsProvider} onChange={(e) => setDnsProvider(e.target.value as "aliyun" | "manual")}><option value="aliyun">{copy.aliyunMode}</option><option value="manual">{copy.manualMode}</option></select></label>
        {dnsProvider === "manual" ? <div className="acme-notice">{copy.manualHint}</div> : <label><span>{copy.selectCredential}</span><select required value={credentialId} onChange={(e) => setCredentialId(e.target.value)}><option value="" disabled>{copy.selectCredential}</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.accessKeyHint}</option>)}</select><p>{credentials.length ? copy.credentialBindingHint : copy.noCredentials}</p></label>}
        <label><span>{dnsProvider === "manual" ? copy.manualZone : copy.zone}</span><input required value={zone} onChange={(e) => setZone(e.target.value)} placeholder="example.com" maxLength={253} autoCapitalize="none" spellCheck={false} /><p>{dnsProvider === "manual" ? copy.manualZoneHint : copy.zoneHint}</p></label>
        <label><span>{copy.domains}</span><textarea required value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={"example.com\n*.example.com"} maxLength={6000} spellCheck={false} /><p>{copy.wildcardHint}</p></label>
        <label><span>{copy.environment}</span><select value={environment} onChange={(e) => setEnvironment(e.target.value)}><option value="staging">{copy.staging}</option><option value="production">{copy.production}</option></select><p>{copy.stagingHint}</p></label>
        {dnsProvider === "aliyun" && <p>{copy.renewInDetails}</p>}
        <div className="security-note"><ShieldCheck size={17} /><span>{copy.deployHint}</span></div>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{common.cancel}</button><button className="primary-button" disabled={!configured || !groupId || (dnsProvider === "aliyun" && !credentials.some((item) => item.id === credentialId)) || busy}>{busy && <RefreshCw size={15} className="spinning" />}{dnsProvider === "manual" ? copy.manualGenerate : copy.submit}</button></div>
      </form> : <div className="acme-order-list">
        {completed?.certificateId && <div className="acme-notice success" role="status"><p>{completed.name} · {copy.issuedMoved}</p><button className="secondary-button" onClick={() => onOpenCertificate(completed.certificateId!)}>{copy.viewCertificate}</button></div>}
        <p>{copy.pendingHint}</p>
        {!orders.length && <div className="empty-state"><FileKey2 size={28} /><h3>{copy.empty}</h3><button className="primary-button" onClick={() => setTab("new")}>{copy.newOrder}</button></div>}
        {orders.map((order) => <AcmeOrderCard key={order.id} order={order} language={language} groupName={groups.find((g) => g.id === order.groupId)?.name} busy={busy} onAction={(action) => void change(order, action)} />)}
        {pagination.pages > 1 && <nav className="acme-pagination" aria-label={copy.orders}><button className="secondary-button" disabled={busy || pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>{copy.previousPage}</button><span>{pagination.page} / {pagination.pages}</span><button className="secondary-button" disabled={busy || pagination.page >= pagination.pages} onClick={() => setPage(pagination.page + 1)}>{copy.nextPage}</button></nav>}
        <p>{copy.deployHint}</p>
      </div>}
    </div>
  </div>;
}

type OrderAction = "renew" | "autoRenew" | "remove" | "checkDns" | "continue";

function AcmeOrderCard({ order, language, groupName, busy, onAction, renewal = false }: {
  order: AcmeOrder; language: Language; groupName?: string; busy: boolean; onAction: (action: OrderAction) => void; renewal?: boolean;
}) {
  const copy = acmeMessages(language);
  const manualDetails = <ManualDnsDetails order={order} language={language} busy={busy} onAction={onAction} />;
  return <article className="acme-order">
    <div className="acme-order-heading"><strong>{renewal ? "Let’s Encrypt" : order.name}</strong><span className={`acme-state ${order.status}`}>{copy[order.status]}</span></div>
    {!renewal && <p className="acme-domains">{order.domains.join(" · ")}</p>}
    <div className="acme-order-meta"><span className={order.environment === "staging" ? "acme-staging" : ""}>{copy[order.environment]}</span>{groupName && <span>{groupName}</span>}</div>
    <p className="acme-bound-credential">{order.dnsProvider === "manual" ? copy.manualMode : `${copy.credentialName}: ${order.credentialName || copy.CREDENTIAL_REQUIRED}`}</p>
    {order.status === "queued" && <p role="status">{order.dnsProvider === "manual" && !order.manualExpiresAt ? copy.manualQueued : copy.queuedHint}</p>}
    {order.status === "running" && <p role="status"><RefreshCw size={12} className="spinning" /> {copy[order.stage as keyof typeof copy] || copy.running}</p>}
    {order.lastError && <div className="acme-notice error">{errorText(new Error(order.lastError), language)}{order.autoRenew && order.certificateId && <p>{copy.nextRetry}: {new Date(order.nextAttemptAt).toLocaleString(language)}</p>}</div>}
    {order.dnsProvider === "manual" && (order.status === "issued" ? order.manualRecords.length > 0 && <details className="acme-previous-dns"><summary>{copy.previousDns}</summary>{manualDetails}</details> : manualDetails)}
    {renewal && <div className="acme-renew-settings">{order.dnsProvider === "aliyun" ? <label className="acme-check"><input type="checkbox" checked={order.autoRenew} disabled={busy} onChange={() => onAction("autoRenew")} /><span>{copy.autoRenew}<small>{copy.renewHint}</small></span></label> : <p>{copy.MANUAL_DNS_ONLY}</p>}</div>}
    <div className="acme-order-actions">
      {["issued", "failed"].includes(order.status) && <button className="secondary-button" disabled={busy} onClick={() => onAction("renew")}><RefreshCw size={13} />{order.status === "failed" ? copy.retryIssuance : copy.renew}</button>}
      {!renewal && !order.certificateId && order.status !== "running" && <button className="ghost-button" disabled={busy} onClick={() => onAction("remove")}>{copy.remove}</button>}
    </div>
  </article>;
}

export function CertificateAcmePanel({ language, certificateId, onIssued }: { language: Language; certificateId: string; onIssued: () => void }) {
  const copy = acmeMessages(language);
  const [order, setOrder] = useState<AcmeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pendingCleanup, setPendingCleanup] = useState(0);
  const issuedAt = useRef<string | null | undefined>(undefined);
  const onIssuedRef = useRef(onIssued);
  useEffect(() => { onIssuedRef.current = onIssued; }, [onIssued]);
  const refresh = useCallback(async () => {
    const result = await api(`/api/acme/orders?certificateId=${certificateId}`);
    const next: AcmeOrder | null = result.data[0] || null;
    if (next?.lastIssuedAt && issuedAt.current !== next.lastIssuedAt) onIssuedRef.current();
    issuedAt.current = next?.lastIssuedAt ?? null;
    setOrder(next); setPendingCleanup(result.pendingCleanup);
  }, [certificateId]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { if (active) await refresh(); }
      catch (error) { if (active) setError(error); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);
  async function change(action: OrderAction) {
    if (!order || action === "remove") return;
    if (action === "renew" && !window.confirm(order.dnsProvider === "manual" ? copy.manualRetryConfirm : copy.renewConfirm)) return;
    setBusy(true); setError(null);
    try {
      await api("/api/acme/orders", { id: order.id, action, autoRenew: !order.autoRenew }, "PATCH");
      await refresh();
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <section className="detail-section certificate-acme-panel" aria-label={copy.renewalTitle}>
    <h3>{copy.renewalTitle}</h3>
    {error != null && <div className="acme-notice error" role="alert">{errorText(error, language)}</div>}
    {pendingCleanup > 0 && <div className="acme-notice">{copy.cleanup}</div>}
    {loading ? <p>{messages[language].loadingContent}</p> : order ? <><AcmeOrderCard order={order} language={language} busy={busy} renewal onAction={(action) => void change(action)} /><p>{copy.deployHint}</p></> : error == null && <p>{copy.noLinkedOrder}</p>}
  </section>;
}

function ManualDnsDetails({ order, language, busy, onAction }: { order: AcmeOrder; language: Language; busy: boolean; onAction: (action: "checkDns" | "continue") => void }) {
  const copy = acmeMessages(language);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const expired = Boolean(order.manualExpiresAt && Date.parse(order.manualExpiresAt) <= now);
  const checkedRecently = Boolean(order.dnsCheckedAt && now - Date.parse(order.dnsCheckedAt) <= 10 * 60_000);
  const actionable = ["waiting_dns", "dns_ready", "failed"].includes(order.status) && Boolean(order.manualExpiresAt) && !expired && order.lastError !== "MANUAL_EXPIRED";
  async function copyValue(value: string) {
    try { await copyText(value); setCopied(value); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  }
  if (!order.manualExpiresAt) return null;
  return <section className="manual-dns-details" aria-label={copy.manualRecordsTitle}>
    <h4>{copy.manualRecordsTitle}</h4>
    <p>{order.status === "issued" ? copy.manualCleanup : copy.manualRecordsHint}</p>
    {order.status !== "issued" && <p>{copy.manualExpires}: {new Date(order.manualExpiresAt!).toLocaleString(language)}</p>}
    {expired && order.status !== "issued" && <div className="acme-notice error">{copy.MANUAL_EXPIRED}</div>}
    {copyFailed && <p role="status">{copy.copyManually}</p>}
    {order.manualRecords.map((record, index) => <div className="manual-dns-record" key={`${record.name}:${record.value}`}>
      <div className="manual-dns-heading"><strong>TXT · {record.domain}</strong>{order.status !== "issued" && <span>{record.verified ? copy.recordVerified : copy.recordPending}</span>}</div>
      {([[copy.recordHost, record.rr], [copy.recordName, record.name], [copy.recordValue, record.value]] as const).map(([label, value]) => <div className="manual-dns-field" key={label}>
        <label htmlFor={`${order.id}-${index}-${label}`}>{label}</label><div><input id={`${order.id}-${index}-${label}`} readOnly value={value} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="secondary-button" aria-label={`${copy.copy} ${label}`} onClick={() => void copyValue(value)}>{copied === value ? copy.copied : copy.copy}</button></div>
      </div>)}
    </div>)}
    {!order.manualRecords.length && ["waiting_dns", "dns_ready"].includes(order.status) && <p>{copy.manualNoRecords}</p>}
    {order.status === "dns_ready" && !expired && <div className={`acme-notice ${checkedRecently ? "success" : ""}`} role="status">{checkedRecently ? copy.manualCheckPassed : copy.MANUAL_CHECK_REQUIRED}</div>}
    {actionable && <div className="manual-dns-actions"><button className="secondary-button" disabled={busy} onClick={() => onAction("checkDns")}>{busy && <RefreshCw size={13} className="spinning" />}{copy.checkDns}</button><button className="primary-button" disabled={busy || order.status !== "dns_ready" || !checkedRecently} onClick={() => onAction("continue")}>{copy.continueIssuance}</button></div>}
  </section>;
}
