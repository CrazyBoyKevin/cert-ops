export function Brand() {
  return <div className="brand" role="img" aria-label="CertOps">
    <svg className="brand-symbol" viewBox="0 0 36 40" fill="none" aria-hidden="true">
      <path d="M22 4H8a3 3 0 0 0-3 3v26a3 3 0 0 0 3 3h11M22 4l8 8v7M22 4v6a2 2 0 0 0 2 2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 17h11M11 22h6" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="26" cy="29" r="8" className="brand-seal" />
      <path d="m22.5 29 2.3 2.3 4.7-4.6" stroke="#121a2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span className="brand-copy" aria-hidden="true"><span className="brand-name">Cert<span>Ops</span></span></span>
  </div>;
}
