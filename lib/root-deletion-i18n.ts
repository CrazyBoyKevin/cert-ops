import type { Language } from "./i18n";
const zh = {
  deleteRoot: "删除根 CA", title: "确认删除根证书？", deleted: "根 CA 已删除",
  warning: "将永久删除该根证书及平台保存的根私钥，无法在平台内恢复。请确认已有必要备份且不再使用；此操作不会撤销外部已部署的证书或系统信任。",
  blocked: "关联 {count} 个服务证书，暂不可删除。请先确认这些证书不再使用，再处理关联服务。",
  CA_IN_USE: "该根 CA 下仍有关联服务证书，禁止删除（包含所有项目及已过期证书）。",
};
type Copy = Record<keyof typeof zh, string>;
const translations: Record<Language, Copy> = {
  "zh-CN": zh,
  "zh-TW": { deleteRoot: "刪除根 CA", title: "確認刪除根憑證？", deleted: "根 CA 已刪除", warning: "將永久刪除此根憑證及平台保存的根私鑰，無法在平台內復原。請確認已備份且不再使用；此操作不會撤銷外部已部署的憑證或系統信任。", blocked: "關聯 {count} 個服務憑證，暫不可刪除。請先確認不再使用，再處理關聯服務。", CA_IN_USE: "此根 CA 仍有關聯服務憑證，禁止刪除（包含所有專案及過期憑證）。" },
  en: { deleteRoot: "Delete root CA", title: "Delete this root certificate?", deleted: "Root CA deleted", warning: "Permanently deletes this root certificate and its stored private key. There is no in-app recovery. Ensure backups exist and it is no longer in use. Deployed certificates and system trust are not revoked.", blocked: "Linked to {count} service certificates; deletion is blocked. Verify they are no longer in use before removing linked services.", CA_IN_USE: "This root CA still has linked service certificates. Deletion is blocked across all projects, including expired certificates." },
  ja: { deleteRoot: "ルート CA を削除", title: "ルート証明書を削除しますか？", deleted: "ルート CA を削除しました", warning: "ルート証明書と保存済み秘密鍵を完全に削除します。アプリ内では復元できません。バックアップと未使用を確認してください。配備済み証明書やシステムの信頼は失効しません。", blocked: "サービス証明書が {count} 件あるため削除できません。未使用を確認してから関連サービスを処理してください。", CA_IN_USE: "関連するサービス証明書があるため削除できません。全プロジェクトと期限切れ証明書も対象です。" },
  ko: { deleteRoot: "루트 CA 삭제", title: "루트 인증서를 삭제할까요?", deleted: "루트 CA가 삭제되었습니다", warning: "루트 인증서와 저장된 개인키를 영구 삭제하며 앱에서 복구할 수 없습니다. 백업 및 미사용 여부를 확인하세요. 배포된 인증서와 시스템 신뢰는 폐기되지 않습니다.", blocked: "서비스 인증서 {count}개가 연결되어 삭제할 수 없습니다. 미사용 여부를 확인한 뒤 연결된 서비스를 처리하세요.", CA_IN_USE: "연결된 서비스 인증서가 있어 삭제할 수 없습니다. 모든 프로젝트와 만료 인증서도 포함됩니다." },
};
export function rootDeletionMessages(language: Language) { return translations[language]; }
