import type { Language } from './i18n';

const zh = {
  title: 'HTTPS 访问',
  active: 'HTTPS 已启用', inactive: '尚未配置 HTTPS', forced: '已强制 HTTPS', optional: 'HTTP / HTTPS 均可访问',
  origin: 'HTTPS 访问地址',
  certificate: '证书链（PEM）', privateKey: '私钥（KEY / PEM）', upload: '选择文件',

  save: '保存并启用 HTTPS', saving: '正在保存…', saved: '证书已保存并生效，请通过 HTTPS 地址检查访问。',
  replace: '更换访问证书', expires: '到期时间', issuer: '颁发机构', fingerprint: 'SHA-256 指纹',
  forceTitle: '强制 HTTPS 访问',
  open: '打开 HTTPS 管理入口',
  enable: '开启强制 HTTPS', disable: '关闭强制 HTTPS', confirm: '已确认 HTTPS 可正常访问？开启后 HTTP 将不再提供管理功能。',

  recovery: '当前处于 HTTPS 恢复模式。修复后请移除 CERTOPS_HTTPS_RECOVERY 并重启。',
  unsupported: '当前启动方式不支持 HTTPS 配置，请使用 npm run dev 或 npm start 启动自定义服务器。',

  failed: '操作失败，请检查服务器日志和配置后重试。', tooLarge: '文件大小不能超过 256 KB。', loading: '正在加载…',
};
type Copy = { [K in keyof typeof zh]: string };
const translations: Record<Language, Copy> = {
  'zh-CN': zh,
  'zh-TW': { title: 'HTTPS 存取', active: 'HTTPS 已啟用', inactive: '尚未設定 HTTPS', forced: '已強制 HTTPS', optional: 'HTTP / HTTPS 皆可存取', origin: 'HTTPS 存取網址', certificate: '憑證鏈（PEM）', privateKey: '私鑰（KEY / PEM）', upload: '選擇檔案', save: '儲存並啟用 HTTPS', saving: '正在儲存…', saved: '憑證已儲存並生效，請透過 HTTPS 網址檢查存取。', replace: '更換存取憑證', expires: '到期時間', issuer: '簽發機構', fingerprint: 'SHA-256 指紋', forceTitle: '強制 HTTPS 存取', open: '開啟 HTTPS 管理入口', enable: '啟用強制 HTTPS', disable: '停用強制 HTTPS', confirm: '已確認 HTTPS 可正常存取？啟用後 HTTP 將不再提供管理功能。', recovery: '目前處於 HTTPS 復原模式。修復後請移除 CERTOPS_HTTPS_RECOVERY 並重新啟動。', unsupported: '目前啟動方式不支援 HTTPS 設定，請使用 npm run dev 或 npm start。', failed: '操作失敗，請檢查伺服器記錄及設定。', tooLarge: '檔案不可超過 256 KB。', loading: '載入中…' },
  en: { title: 'HTTPS access', active: 'HTTPS enabled', inactive: 'HTTPS not configured', forced: 'HTTPS enforced', optional: 'HTTP and HTTPS available', origin: 'Public HTTPS URL', certificate: 'Certificate chain (PEM)', privateKey: 'Private key (KEY / PEM)', upload: 'Choose file', save: 'Save and enable HTTPS', saving: 'Saving…', saved: 'Certificate applied. Verify access using the HTTPS URL.', replace: 'Replace TLS certificate', expires: 'Expires', issuer: 'Issuer', fingerprint: 'SHA-256 fingerprint', forceTitle: 'Enforce HTTPS', open: 'Open HTTPS console', enable: 'Enforce HTTPS', disable: 'Stop enforcing HTTPS', confirm: 'Have you verified HTTPS access? HTTP will no longer serve the console.', recovery: 'HTTPS recovery mode is active. Remove CERTOPS_HTTPS_RECOVERY and restart after repair.', unsupported: 'Start the custom server with npm run dev or npm start to configure HTTPS.', failed: 'Operation failed. Check server logs and configuration.', tooLarge: 'Files must be at most 256 KB.', loading: 'Loading…' },
  ja: { title: 'HTTPS アクセス', active: 'HTTPS 有効', inactive: 'HTTPS 未設定', forced: 'HTTPS を強制中', optional: 'HTTP / HTTPS が利用可能', origin: '公開 HTTPS URL', certificate: '証明書チェーン（PEM）', privateKey: '秘密鍵（KEY / PEM）', upload: 'ファイルを選択', save: '保存して HTTPS を有効化', saving: '保存中…', saved: '証明書を適用しました。HTTPS URL で確認してください。', replace: 'アクセス証明書の交換', expires: '有効期限', issuer: '発行者', fingerprint: 'SHA-256 指紋', forceTitle: 'HTTPS を強制', open: 'HTTPS 管理画面を開く', enable: 'HTTPS を強制する', disable: 'HTTPS の強制を解除', confirm: 'HTTPS アクセスを確認しましたか？HTTP では管理機能を利用できなくなります。', recovery: 'HTTPS 復旧モードです。修復後、CERTOPS_HTTPS_RECOVERY を削除して再起動してください。', unsupported: 'npm run dev または npm start でカスタムサーバーを起動してください。', failed: '操作に失敗しました。サーバーログと設定を確認してください。', tooLarge: 'ファイルは 256 KB 以下にしてください。', loading: '読み込み中…' },
  ko: { title: 'HTTPS 접속', active: 'HTTPS 활성화됨', inactive: 'HTTPS 미설정', forced: 'HTTPS 강제 적용 중', optional: 'HTTP / HTTPS 모두 사용 가능', origin: '공개 HTTPS 주소', certificate: '인증서 체인 (PEM)', privateKey: '개인 키 (KEY / PEM)', upload: '파일 선택', save: '저장하고 HTTPS 활성화', saving: '저장 중…', saved: '인증서가 적용되었습니다. HTTPS 주소로 접속을 확인하세요.', replace: '접속 인증서 교체', expires: '만료일', issuer: '발급 기관', fingerprint: 'SHA-256 지문', forceTitle: 'HTTPS 접속 강제', open: 'HTTPS 관리 화면 열기', enable: 'HTTPS 강제 적용', disable: 'HTTPS 강제 해제', confirm: 'HTTPS 접속을 확인했나요? HTTP 관리 기능이 비활성화됩니다.', recovery: 'HTTPS 복구 모드입니다. 복구 후 CERTOPS_HTTPS_RECOVERY를 제거하고 다시 시작하세요.', unsupported: 'npm run dev 또는 npm start로 사용자 지정 서버를 시작하세요.', failed: '작업에 실패했습니다. 서버 로그와 설정을 확인하세요.', tooLarge: '파일 크기는 256 KB 이하여야 합니다.', loading: '불러오는 중…' },
};
export function httpsMessages(language: Language) { return translations[language]; }

export function httpsError(code: string, language: Language) {
  const chinese = language === 'zh-CN' || language === 'zh-TW';
  const errors: Record<string, [string, string]> = {
    INVALID_CERTIFICATE: ['证书无效：请检查有效期、证书链、私钥匹配及文件格式；不能使用根 CA 作为服务器证书。', 'Invalid certificate: check validity, chain, matching key and PEM format. A CA cannot be used as the server certificate.'],
    HOSTNAME_MISMATCH: ['HTTPS 地址不在证书的域名 / IP 范围内。', 'The certificate does not cover the HTTPS hostname / IP.'],
    INVALID_ORIGIN: ['请填写有效的 HTTPS 地址（不含路径），并从同源页面操作。', 'Use a valid HTTPS origin without a path and submit from the same origin.'],
    ENCRYPTION_KEY_REQUIRED: ['请配置至少 32 位随机字符的 CERT_ENCRYPTION_KEY，再上传证书。', 'Configure a strong CERT_ENCRYPTION_KEY of at least 32 characters first.'],
    VERIFY_HTTPS_FIRST: ['请先通过配置的 HTTPS 地址登录，再开启强制访问。', 'Sign in at the configured HTTPS origin before enforcing HTTPS.'],
    DISABLE_FORCE_FIRST: ['更换访问地址前，请先关闭强制 HTTPS。', 'Disable HTTPS enforcement before changing the public origin.'],
    BUSY: ['另一个操作正在进行，请稍后重试。', 'Another update is in progress. Try again shortly.'],
  };
  return errors[code]?.[chinese ? 0 : 1] || httpsMessages(language).failed;
}
