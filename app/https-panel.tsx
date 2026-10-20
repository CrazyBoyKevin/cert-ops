"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Language } from '@/lib/i18n';
import type { HttpsStatus } from '@/lib/platform-https';
import { httpsMessages, httpsError } from '@/lib/https-i18n';
import { loginHref } from '@/lib/app-route';

export function HttpsSettingsPanel({ language }: { language: Language }) {
  const copy = httpsMessages(language);
  const [status, setStatus] = useState<HttpsStatus | null>(null);
  const [origin, setOrigin] = useState('');
  const [cert, setCert] = useState(''); const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  async function request(body?: object) {
    const response = await fetch('/api/platform/https', body ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    if (response.status === 401) { window.location.replace(loginHref('/settings?tab=https')); throw new Error('UNAUTHORIZED'); }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result.data as HttpsStatus;
  }
  useEffect(() => { let active = true; request().then((data) => { if (active) { setStatus(data); setOrigin(data.origin || ''); } }).catch(() => { if (active) setError('HTTPS_SAVE_FAILED'); }); return () => { active = false; }; }, []);
  async function upload(event: React.ChangeEvent<HTMLInputElement>, target: 'cert' | 'key') {
    const file = event.target.files?.[0]; if (!file) return;
    event.target.value = '';
    if (file.size > 256 * 1024) { setError('INPUT_TOO_LARGE'); return; }
    try { const text = await file.text(); if (target === 'cert') setCert(text); else setKey(text); setError(''); }
    catch { setError('HTTPS_SAVE_FAILED'); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try { setStatus(await request({ action: 'certificate', cert, key, origin })); setKey(''); setCert(''); setSaved(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'HTTPS_SAVE_FAILED'); }
    finally { setBusy(false); }
  }
  async function force() {
    if (!status) return;
    if (!status.forced && !window.confirm(copy.confirm)) return;
    setBusy(true); setError(''); setSaved(false);
    try { setStatus(await request({ action: 'force', enabled: !status.forced })); }
    catch (error) { setError(error instanceof Error ? error.message : 'HTTPS_SAVE_FAILED'); }
    finally { setBusy(false); }
  }
  return <div className="https-settings settings-pane">
    <div className="settings-pane-heading"><h3>{copy.title}</h3></div>
    {error && <p className="https-notice error" role="alert">{error === 'INPUT_TOO_LARGE' ? copy.tooLarge : httpsError(error, language)}</p>}
    {!status && !error && <p role="status">{copy.loading}</p>}
    {status && !status.supported && <p className="https-notice">{copy.unsupported}</p>}
    {status?.supported && <>
      {status.recovery && <p className="https-notice">{copy.recovery}</p>}
      <div className="https-status"><ShieldCheck size={21} /><div><strong>{status.configured ? copy.active : copy.inactive}</strong>{status.configured && <small>{status.forced ? copy.forced : copy.optional}</small>}</div>{status.configured && <a className="secondary-button" href={`${status.origin}/settings?tab=https`} target="_blank" rel="noopener noreferrer">{copy.open}<ExternalLink size={14} /></a>}</div>
      {status.certificate && <dl className="https-details"><div><dt>{copy.origin}</dt><dd>{status.origin}</dd></div><div><dt>{copy.expires}</dt><dd>{new Date(status.certificate.expiresAt).toLocaleString(language)}</dd></div><div><dt>{copy.issuer}</dt><dd>{status.certificate.issuer}</dd></div><div><dt>{copy.fingerprint}</dt><dd className="https-fingerprint">{status.certificate.fingerprint}</dd></div></dl>}
      <form className="https-form" onSubmit={save}>
        {status.configured && <h4>{copy.replace}</h4>}
        <label><span>{copy.origin}</span><input type="url" value={origin} onChange={(event) => setOrigin(event.target.value)} required placeholder="https://certops.example.com:9443" disabled={busy} /></label>
        <div className="https-files">{(['cert', 'key'] as const).map((target) => <div className="https-file" key={target}>
          <div className="https-file-heading"><label htmlFor={`https-${target}`}>{target === 'cert' ? copy.certificate : copy.privateKey}</label><label className="https-file-upload"><UploadCloud size={14} />{copy.upload}<input type="file" accept={target === 'cert' ? '.pem,.crt,.cer' : '.key,.pem'} disabled={busy} onChange={(event) => void upload(event, target)} /></label></div>
          <textarea id={`https-${target}`} value={target === 'cert' ? cert : key} onChange={(event) => target === 'cert' ? setCert(event.target.value) : setKey(event.target.value)} required spellCheck={false} autoComplete="off" maxLength={256 * 1024} disabled={busy} placeholder={target === 'cert' ? '-----BEGIN CERTIFICATE-----' : '-----BEGIN PRIVATE KEY-----'} />
        </div>)}</div>
        {saved && <p className="https-notice success" role="status">{copy.saved}</p>}
        <div className="https-form-actions"><button className="primary-button" disabled={busy || !cert.trim() || !key.trim()}>{busy ? copy.saving : copy.save}</button></div>
      </form>
      <div className="https-enforcement"><div><h4>{copy.forceTitle}</h4></div><button type="button" className={status.forced ? 'secondary-button' : 'primary-button'} disabled={busy || !status.configured || (!status.forced && (!status.secure || status.recovery))} onClick={() => void force()}>{status.forced ? copy.disable : copy.enable}</button></div>
    </>}
  </div>;
}
