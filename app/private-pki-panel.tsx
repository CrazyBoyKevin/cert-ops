"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { messages, type Language } from "@/lib/i18n";
import { pkiMessages } from "@/lib/private-pki-i18n";
import { pkiManagementMessages } from "@/lib/pki-management-i18n";
import { navigationMessages } from "@/lib/navigation-i18n";
import { rootDeletionMessages } from "@/lib/root-deletion-i18n";
import { certificatesInScope } from "@/lib/certificate-scope";
import { loginHref } from "@/lib/app-route";
import type { Certificate, Group } from "@/lib/types";

export type Authority = { id: string; subject: Record<string, string>; expiresAt: string; fingerprint: string; hasPrivateKey: boolean; serviceCount: number };
type Version = { id: string; metadata: Certificate; createdAt: string; hasPrivateKey: boolean };
type Service = { authorityId: string; subject: Record<string, string>; fingerprint: string; versions: Version[]; hasSigningKey: boolean; ipOnly: boolean };
async function request(body?: unknown, certificateId?: string) {
  const response = await fetch(`/api/private-pki${certificateId ? `?certificateId=${encodeURIComponent(certificateId)}` : ""}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401) { window.location.replace(loginHref(window.location.pathname + window.location.search)); throw new Error("UNAUTHORIZED"); }
  if (!response.ok) throw new Error((await response.json()).error || "SERVICE_UNAVAILABLE");
  return response;
}
async function api(body?: unknown, certificateId?: string) { return (await (await request(body, certificateId)).json()).data; }
async function download(body: unknown, filename: string) {
  const response = await request(body), url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function errorText(error: unknown, language: Language) {
  const code = error instanceof Error ? error.message : "SERVICE_UNAVAILABLE", copy = { ...pkiMessages(language), ...pkiManagementMessages(language), ...rootDeletionMessages(language) };
  return copy[code as keyof typeof copy] || messages[language].operationFailed;
}
function date(value: string, language: Language) { return new Date(value).toLocaleDateString(language); }
function Feedback({ error, success, language }: { error: unknown; success?: string; language: Language }) {
  return error ? <p className="pki-feedback error" role="alert">{errorText(error, language)}</p> : success ? <p className="pki-feedback" role="status">{success}</p> : null;
}
function Validity({ value, onChange, language, root = false }: { value: number; onChange: (value: number) => void; language: Language; root?: boolean }) {
  return <label><span>{pkiMessages(language).days}</span><select value={value} onChange={e => onChange(Number(e.target.value))}>{(root ? [1825, 3650, 7300] : [30, 90, 180, 365]).map(days => <option key={days} value={days}>{days}</option>)}</select></label>;
}

export function PrivateCaSettings({ language, onChanged }: { language: Language; onChanged?: () => void }) {
  const copy = pkiMessages(language), common = messages[language], management = pkiManagementMessages(language);
  const deletion = rootDeletionMessages(language);
  const [deleteTarget, setDeleteTarget] = useState<Authority | null>(null), [deleteError, setDeleteError] = useState<unknown>(null);
  const [roots, setRoots] = useState<Authority[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null), [success, setSuccess] = useState("");
  const [open, setOpen] = useState(false), [days, setDays] = useState(3650);
  const [subject, setSubject] = useState({ CN: "", O: "", OU: "", C: "", ST: "", L: "" });
  const [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [servicesRoot, setServicesRoot] = useState<Authority | null>(null);
  useEffect(() => { let active = true; api().then(data => { if (active) setRoots(data); }).catch(e => { if (active) setError(e); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess("");
    try { await api({ action: "createCA", subject, days }); setOpen(false); setSubject({ CN: "", O: "", OU: "", C: "", ST: "", L: "" }); setSuccess(copy.created); setRoots(await api()); setPage(0); onChanged?.(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function exportRoot(id: string, format: string) { setBusy(true); setError(null); try { await download({ action: "downloadRoot", id, format }, format === "der" ? "root-ca.cer" : "root-ca.crt"); } catch (e) { setError(e); } finally { setBusy(false); } }
  async function deleteRoot() {
    if (!deleteTarget || deleteTarget.serviceCount > 0 || busy) return;
    setBusy(true); setDeleteError(null); setError(null); setSuccess("");
    try {
      await api({ action: "deleteCA", id: deleteTarget.id, confirmed: true });
      const deletedId = deleteTarget.id;
      setRoots(items => items.filter(root => root.id !== deletedId)); setDeleteTarget(null); setPage(0); setSuccess(deletion.deleted);
      try { if (localStorage.getItem("certops-private-ca") === deletedId) localStorage.removeItem("certops-private-ca"); } catch {}
      onChanged?.();
    } catch (e) {
      setDeleteError(e);
      // A service may have been added since the list loaded. Refresh the guard without hiding the failure.
      try { const latest: Authority[] = await api(); setRoots(latest); setDeleteTarget(current => latest.find(root => root.id === current?.id) || current); } catch {}
    } finally { setBusy(false); }
  }
  const filtered = roots.filter(root => JSON.stringify(root.subject).toLowerCase().includes(search.toLowerCase()));
  return <div className="settings-pane pki-panel">
    <div className="acme-credentials-heading"><h3>{copy.roots}</h3><div className="pki-actions"><button className="secondary-button" disabled={busy || loading} onClick={() => setImportOpen(true)}>{management.importRoot}</button><button className="secondary-button" disabled={busy || loading} onClick={() => setOpen(!open)}><Plus size={15} />{copy.createRoot}</button></div></div>
    <p className="pki-note">{copy.rootHint}</p>
    <Feedback error={error} success={success} language={language} />
    {open && <form className="pki-form pki-card" onSubmit={create}><fieldset disabled={busy}><div className="form-grid two">{(Object.keys(subject) as (keyof typeof subject)[]).map(key => <label key={key}><span>{copy[key]}{key === "CN" ? " *" : ""}</span><input required={key === "CN"} maxLength={key === "C" ? 2 : ["ST", "L"].includes(key) ? 128 : 64} value={subject[key]} onChange={e => setSubject({ ...subject, [key]: e.target.value })} /></label>)}</div><Validity root value={days} onChange={setDays} language={language} /><div className="pki-actions"><button type="button" className="ghost-button" onClick={() => setOpen(false)}>{common.cancel}</button><button className="primary-button">{busy ? copy.busy : copy.createRoot}</button></div></fieldset></form>}
    {loading ? <p>{common.loadingContent}</p> : <><input className="pki-search" aria-label={management.rootSearch} placeholder={management.rootSearch} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
      <div className="pki-list">{filtered.slice(page * 5, page * 5 + 5).map(root => <article className="pki-card" key={root.id}><div className="pki-ca-heading"><strong>{root.subject.CN}</strong><span className={`acme-state ${root.hasPrivateKey ? "issued" : ""}`}>{root.hasPrivateKey ? management.signing : management.readOnly}</span></div><p>{Object.entries(root.subject).filter(([key]) => key !== "CN").map(([key, value]) => `${key}=${value}`).join(" · ")}</p><p>{common.expiryDate}: {date(root.expiresAt, language)}</p><code className="pki-fingerprint">SHA-256: {root.fingerprint}</code><div className="pki-actions"><button className="secondary-button" onClick={() => setServicesRoot(root)}>{navigationMessages(language).allProjectServices} · {root.serviceCount}</button><button className="secondary-button" disabled={busy} onClick={() => void exportRoot(root.id, "pem")}><Download size={14} />.crt</button><button className="secondary-button" disabled={busy} onClick={() => void exportRoot(root.id, "der")}><Download size={14} />.cer</button><button className="group-delete-button" disabled={busy || root.serviceCount > 0} aria-label={`${deletion.deleteRoot} ${root.subject.CN}`} title={root.serviceCount > 0 ? deletion.blocked.replace("{count}", String(root.serviceCount)) : deletion.deleteRoot} onClick={() => { setDeleteError(null); setDeleteTarget(root); }}><Trash2 size={14} />{deletion.deleteRoot}</button></div>{root.serviceCount > 0 && <p className="pki-note root-delete-blocked">{deletion.blocked.replace("{count}", String(root.serviceCount))}</p>}</article>)}</div>
      {!filtered.length && <p className="pki-note">{roots.length ? common.noResults : management.noRoots}</p>}
      {filtered.length > 5 && <div className="pki-pagination"><button className="ghost-button" disabled={!page} onClick={() => setPage(page - 1)}>{copy.previous}</button><span>{page + 1} / {Math.ceil(filtered.length / 5)}</span><button className="ghost-button" disabled={(page + 1) * 5 >= filtered.length} onClick={() => setPage(page + 1)}>{copy.next}</button></div>}</>}
    {servicesRoot && <RootServicesModal root={servicesRoot} language={language} onClose={() => setServicesRoot(null)} />}
    {importOpen && <PrivateImportModal language={language} onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setSuccess(management.imported); void api().then(setRoots).catch(setError); onChanged?.(); }} />}
    {deleteTarget && <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setDeleteTarget(null); }}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-root-title"><button className="modal-close" aria-label={common.cancel} disabled={busy} onClick={() => setDeleteTarget(null)}><X size={19} /></button><span className="danger-icon"><Trash2 size={22} /></span><h2 id="delete-root-title">{deletion.title}</h2><p>{deletion.warning}</p><div className="delete-cert"><ShieldCheck size={18} /><span><strong>{deleteTarget.subject.CN}</strong><small>{deleteTarget.id}</small></span></div><code className="pki-fingerprint">SHA-256: {deleteTarget.fingerprint}</code><Feedback error={deleteError} language={language} />{deleteTarget.serviceCount > 0 && <p className="pki-feedback error">{deletion.blocked.replace("{count}", String(deleteTarget.serviceCount))}</p>}<div className="modal-actions"><button className="ghost-button" disabled={busy} onClick={() => setDeleteTarget(null)}>{common.cancel}</button><button className="danger-button" disabled={busy || deleteTarget.serviceCount > 0} onClick={() => void deleteRoot()}>{busy ? common.deleting : deletion.deleteRoot}</button></div></div></div>}
  </div>;
}

function RootServicesModal({ root, language, onClose }: { root: Authority; language: Language; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const common = messages[language];
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/certificates", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.replace(loginHref(window.location.pathname + window.location.search)); return; }
        if (!response.ok) throw new Error("SERVICE_UNAVAILABLE");
        const result = await response.json();
        if (!controller.signal.aborted) setCertificates(certificatesInScope(result.data || [], "private", root.id));
      } catch (error) { if (!controller.signal.aborted) setError(error); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); element?.close(); };
  }, [root.id]);
  return <dialog ref={dialog} className="modal root-services-modal" aria-labelledby="root-services-title" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <button className="modal-close" aria-label={common.cancel} onClick={onClose}><X size={19} /></button>
    <div className="modal-title-row"><span className="title-icon"><ShieldCheck size={20} /></span><div><h2 id="root-services-title">{navigationMessages(language).caServices}</h2><p>{root.subject.CN}{!loading && !error ? ` · ${certificates.length}` : ""}</p></div></div>
    <Feedback error={error} language={language} />
    {loading ? <p className="root-services-state" role="status">{common.loadingContent}</p> : !error && (certificates.length ? <div className="table-wrap root-services-table"><table>
      <thead><tr><th>{common.certDomain}</th><th>{common.project}</th><th>{common.expiryDate}</th></tr></thead>
      <tbody>{certificates.map(certificate => <tr key={certificate.id}>
        <td><strong>{certificate.name}</strong><small>{certificate.domains.join(" · ") || certificate.primaryDomain}</small></td>
        <td>{certificate.groupName || "—"}</td><td>{date(certificate.expiresAt, language)}</td>
      </tr>)}</tbody>
    </table></div> : <p className="root-services-state">{common.noCertificates}</p>)}
  </dialog>;
}

export function PrivateIssueModal({ language, groups, initialGroup, initialAuthority, onClose, onIssued, onConfigure }: { language: Language; groups: Group[]; initialGroup: string; initialAuthority?: string; onClose: () => void; onIssued: (id: string) => void; onConfigure: () => void }) {
  const copy = pkiMessages(language), common = messages[language], management = pkiManagementMessages(language);
  const [roots, setRoots] = useState<Authority[]>([]), [authorityId, setAuthorityId] = useState("");
  const [groupId, setGroupId] = useState(groups.some(g => g.id === initialGroup) ? initialGroup : groups[0]?.id || "");
  const [name, setName] = useState(""), [ips, setIps] = useState(""), [days, setDays] = useState(365);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; api().then((data: Authority[]) => { if (!active) return; const available = data.filter(root => root.hasPrivateKey && Date.parse(root.expiresAt) > Date.now()); setRoots(available); let saved: string | null = null; try { saved = localStorage.getItem("certops-private-ca"); } catch {} setAuthorityId(available.find(root => root.id === initialAuthority)?.id || available.find(root => root.id === saved)?.id || available[0]?.id || ""); }).catch(e => { if (active) setError(e); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [initialAuthority]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const data = await api({ action: "issue", authorityId, groupId, name, ips, days }); try { localStorage.setItem("certops-private-ca", authorityId); } catch {} onIssued(data.certificateId); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}><div className="modal pki-modal" role="dialog" aria-modal="true" aria-labelledby="pki-title"><button className="modal-close" aria-label={common.cancel} disabled={busy} onClick={onClose}><X size={19} /></button><div className="modal-title-row"><span className="title-icon"><ShieldCheck size={20} /></span><h2 id="pki-title">{copy.title}</h2></div>
    <Feedback error={error} language={language} />
    {loading ? <p>{common.loadingContent}</p> : !roots.length ? <><p className="pki-note">{management.noSigningRoots}</p><button className="secondary-button" onClick={onConfigure}>{copy.roots}</button></> : <form className="pki-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="form-grid two"><label><span>{copy.name}</span><input value={name} maxLength={180} onChange={e => setName(e.target.value)} required placeholder="NAS / Nginx" /></label><label><span>{common.project}</span><select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="" disabled>{common.selectGroup}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
      <label><span>{copy.ca}</span><select required value={authorityId} onChange={e => setAuthorityId(e.target.value)}>{roots.map(root => <option key={root.id} value={root.id}>{root.subject.CN} · {date(root.expiresAt, language)} · {root.id.slice(0, 8)}</option>)}</select></label>
      <label><span>{copy.ips}</span><textarea required rows={3} value={ips} onChange={e => setIps(e.target.value)} placeholder={"192.168.1.10\nfd00::10"} /><small>{copy.ipHint}</small></label>
      <Validity value={days} onChange={setDays} language={language} /><p className="pki-note">{copy.trust}</p><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{common.cancel}</button><button className="primary-button" disabled={!groupId || !authorityId}>{busy ? copy.busy : copy.issue}</button></div>
    </fieldset></form>}
  </div></div>;
}

export function PrivateCertificatePanel({ language, certificate, onChanged }: { language: Language; certificate: Certificate; onChanged: () => void }) {
  const copy = pkiMessages(language), common = messages[language], management = pkiManagementMessages(language);
  const [service, setService] = useState<Service | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const [renew, setRenew] = useState(false), [ips, setIps] = useState(certificate.domains.join("\n")), [days, setDays] = useState(365), [page, setPage] = useState(0);
  const [target, setTarget] = useState<Version | null>(null), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { let active = true; api(undefined, certificate.id).then(data => { if (active) setService(data); }).catch(e => { if (active) setError(e); }); return () => { active = false; }; }, [certificate.id]);
  async function action(work: () => Promise<void>) { setBusy(true); setError(null); try { await work(); } catch (e) { setError(e); } finally { setBusy(false); } }
  return <section className="detail-section pki-panel"><h3>{copy.title}</h3><Feedback error={error} language={language} />
    {!service ? <button className="ghost-button" disabled={busy} onClick={() => void action(async () => setService(await api(undefined, certificate.id)))}>{common.refresh}</button> : <>
      <div className="pki-ca-heading"><strong>{service.subject.CN}</strong><button className="ghost-button" disabled={busy} onClick={() => void action(() => download({ action: "downloadRoot", id: service.authorityId }, "root-ca.crt"))}><Download size={14} />{copy.roots}</button></div>
      <p className="pki-note">{copy.trust}</p>{!service.hasSigningKey && <p className="pki-note">{management.CA_KEY_REQUIRED}</p>}{!service.ipOnly && <p className="pki-note">{management.ipOnly}</p>}<button className="secondary-button" disabled={busy || !service.hasSigningKey || !service.ipOnly} onClick={() => setRenew(!renew)}><RefreshCw size={14} />{copy.renew}</button>
      {renew && <form className="pki-form pki-card" onSubmit={e => { e.preventDefault(); void action(async () => { await api({ action: "renew", certificateId: certificate.id, ips, days }); setRenew(false); onChanged(); }); }}><fieldset disabled={busy}><label><span>{copy.ips}</span><textarea required rows={3} value={ips} onChange={e => setIps(e.target.value)} /><small>{copy.ipHint}</small></label><Validity value={days} onChange={setDays} language={language} /><p className="pki-note">{copy.renewalHint}</p><button className="primary-button">{busy ? copy.busy : copy.renew}</button></fieldset></form>}
      <details className="pki-history"><summary>{copy.history} · {service.versions.length}</summary><div className="pki-list">{service.versions.slice(page * 5, page * 5 + 5).map(version => <div className="pki-card" key={version.id}><div className="pki-ca-heading"><strong>{date(version.createdAt, language)}</strong>{version.metadata.fingerprint === service.fingerprint && <span className="acme-state issued">{copy.current}</span>}</div><p>{version.metadata.domains.join(", ")}</p><p>{common.expiryDate}: {date(version.metadata.expiresAt, language)}</p><code className="pki-fingerprint">{version.metadata.fingerprint}</code><div className="pki-actions"><button className="ghost-button" disabled={busy} onClick={() => void action(() => download({ action: "downloadVersion", id: version.id, format: "pem" }, "server.pem"))}>PEM</button><button className="ghost-button" disabled={busy || !version.hasPrivateKey} title={!version.hasPrivateKey ? management.SERVICE_KEY_REQUIRED : ""} onClick={() => void action(() => download({ action: "downloadVersion", id: version.id }, `service-${version.id.slice(0, 8)}.zip`))}><Download size={14} />ZIP</button><button className="ghost-button" disabled={busy} onClick={() => { setTarget(version); setConfirmed(false); }}><Trash2 size={14} />{common.delete}</button></div></div>)}</div>
        {service.versions.length > 5 && <div className="pki-pagination"><button className="ghost-button" disabled={!page} onClick={() => setPage(page - 1)}>{copy.previous}</button><span>{page + 1} / {Math.ceil(service.versions.length / 5)}</span><button className="ghost-button" disabled={(page + 1) * 5 >= service.versions.length} onClick={() => setPage(page + 1)}>{copy.next}</button></div>}
      </details>
    </>}
    {target && <div className="modal-backdrop"><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-version-title"><h2 id="delete-version-title">{copy.deleteVersion}</h2><p>{copy.deleteHint}</p><strong>{certificate.name}</strong><p>{target.metadata.domains.join(", ")} · {date(target.createdAt, language)}</p><code className="pki-fingerprint">{target.metadata.fingerprint}</code><Feedback error={error} language={language} /><label className="confirm-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>{common.deleteConfirm}</span></label><div className="modal-actions"><button className="ghost-button" disabled={busy} onClick={() => setTarget(null)}>{common.cancel}</button><button className="danger-button" disabled={!confirmed || busy} onClick={() => void action(async () => { const result = await api({ action: "deleteVersion", certificateId: certificate.id, id: target.id, confirmed }); setTarget(null); setPage(0); if (!result.serviceDeleted) setService(await api(undefined, certificate.id)); onChanged(); })}>{busy ? copy.busy : common.confirmDelete}</button></div></div></div>}
  </section>;
}

export function PrivateImportModal({ language, groups, initialGroup, initialAuthority, onClose, onImported }: { language: Language; groups?: Group[]; initialGroup?: string; initialAuthority?: string; onClose: () => void; onImported: (id: string) => void }) {
  const common = messages[language], copy = pkiManagementMessages(language), pki = pkiMessages(language), serviceMode = Boolean(groups);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [certificate, setCertificate] = useState(""), [privateKey, setPrivateKey] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null), [keyFile, setKeyFile] = useState<File | null>(null);
  const [roots, setRoots] = useState<Authority[]>([]), [authorityId, setAuthorityId] = useState("");
  const [groupId, setGroupId] = useState(groups?.find(group => group.id === initialGroup)?.id || groups?.[0]?.id || ""), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => { if (!serviceMode) return; let active = true; api().then((data: Authority[]) => { if (active) { setRoots(data); setAuthorityId(data.find(root => root.id === initialAuthority)?.id || data[0]?.id || ""); } }).catch(e => { if (active) setError(e); }); return () => { active = false; }; }, [serviceMode, initialAuthority]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      let contents = certificate, key = privateKey, encoding = "pem";
      if (mode === "file") {
        if (!certificateFile || certificateFile.size > 262_144) throw new Error("INVALID_CERTIFICATE");
        const bytes = new Uint8Array(await certificateFile.arrayBuffer());
        contents = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")); encoding = "base64";
        if (keyFile && keyFile.size > 32_768) throw new Error("INVALID_PRIVATE_KEY");
        key = keyFile ? await keyFile.text() : "";
      }
      const result = await api({ action: serviceMode ? "importService" : "importCA", certificate: contents, encoding, privateKey: key, ...(serviceMode ? { name, groupId, authorityId } : {}) });
      setPrivateKey(""); setKeyFile(null); onImported(serviceMode ? result.certificateId : result.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}><div className="modal pki-modal" role="dialog" aria-modal="true" aria-labelledby="pki-import-title"><button className="modal-close" disabled={busy} onClick={onClose} aria-label={common.cancel}><X size={19} /></button><h2 id="pki-import-title">{serviceMode ? copy.importService : copy.importRoot}</h2><p className="pki-note">{serviceMode ? copy.serviceHint : copy.rootHint}</p><Feedback error={error} language={language} />
    <form className="pki-form" onSubmit={submit}><fieldset disabled={busy}>
      {serviceMode && <><div className="form-grid two"><label><span>{pki.name}</span><input required maxLength={180} value={name} onChange={e => setName(e.target.value)} /></label><label><span>{common.project}</span><select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="" disabled>{common.selectGroup}</option>{groups?.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div><label><span>{pki.ca}</span><select required value={authorityId} onChange={e => setAuthorityId(e.target.value)}><option value="" disabled>{copy.allRoots}</option>{roots.map(root => <option key={root.id} value={root.id}>{root.subject.CN} · {root.id.slice(0, 8)}</option>)}</select></label>{!roots.length && <p className="pki-note">{copy.noRoots}</p>}</>}
      <div className="settings-tabs"><button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>{common.fileUpload}</button><button type="button" className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}>{common.pasteContent}</button></div>
      {mode === "file" ? <><label><span>{serviceMode ? copy.serviceCertificate : copy.rootCertificate}</span><input required type="file" accept=".pem,.crt,.cer,.der" onChange={e => setCertificateFile(e.target.files?.[0] || null)} /></label><label><span>{copy.key}</span><input type="file" accept=".pem,.key" onChange={e => setKeyFile(e.target.files?.[0] || null)} /></label></> : <><label><span>{serviceMode ? copy.serviceCertificate : copy.rootCertificate}</span><textarea required rows={5} spellCheck={false} value={certificate} onChange={e => setCertificate(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" /></label><label><span>{copy.key}</span><textarea rows={3} autoComplete="off" spellCheck={false} value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" /></label></>}
      <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>{common.cancel}</button><button className="primary-button" disabled={serviceMode && (!authorityId || !groupId)}>{busy ? pki.busy : copy.importAction}</button></div>
    </fieldset></form>
  </div></div>;
}
