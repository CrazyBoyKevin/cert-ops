import type { Language } from "./i18n";

const zh = {
  allProjects: "全部项目", certificates: "项目证书", infrastructure: "签发基础设施",
  sharedGroups: "分组在公有与私有证书间共用", projectHint: "先选择项目，再按证书类型管理；左侧数量包含两种类型。",
  rootsHint: "根 CA 是跨项目的签发资源，不属于项目分组。服务证书按项目归档，并关联其签发 CA。",
  publicHint: "管理当前项目范围内的公有证书与普通上传记录。",
  privateHint: "管理当前项目范围内由私有 CA 签发的服务证书。",
  clearCa: "清除 CA 筛选", currentRange: "当前项目 · 公有 + 私有", allProjectServices: "查看跨项目服务证书",
};
type Copy = Record<keyof typeof zh, string>;
const translations: Record<Language, Copy> = {
  "zh-CN": zh,
  "zh-TW": { allProjects: "全部專案", certificates: "專案憑證", infrastructure: "簽發基礎設施", sharedGroups: "公有與私有憑證共用分組", projectHint: "先選擇專案，再依憑證類型管理；左側數量包含兩種類型。", rootsHint: "根 CA 是跨專案的簽發資源，不屬於專案分組。服務憑證按專案歸檔，並關聯簽發 CA。", publicHint: "管理目前專案範圍的公有憑證及一般上傳記錄。", privateHint: "管理目前專案範圍內由私有 CA 簽發的服務憑證。", clearCa: "清除 CA 篩選", currentRange: "目前專案 · 公有 + 私有", allProjectServices: "查看跨專案服務憑證" },
  en: { allProjects: "All projects", certificates: "Project certificates", infrastructure: "Issuing infrastructure", sharedGroups: "Groups are shared across certificate types", projectHint: "Choose a project, then a certificate type. Sidebar counts include both types.", rootsHint: "Root CAs are shared issuing resources, independent of projects. Service certificates belong to a project and reference their issuing CA.", publicHint: "Public certificates and ordinary uploads within this project scope.", privateHint: "Private CA service certificates within this project scope.", clearCa: "Clear CA filter", currentRange: "Current project · public + private", allProjectServices: "View services across projects" },
  ja: { allProjects: "すべてのプロジェクト", certificates: "プロジェクト証明書", infrastructure: "発行基盤", sharedGroups: "グループは公開・プライベート証明書で共通", projectHint: "プロジェクトを選択してから証明書の種類を切り替えます。左側の件数は両種類の合計です。", rootsHint: "ルート CA はプロジェクトを横断する発行リソースです。サービス証明書はプロジェクトに所属し、発行 CA に関連付けられます。", publicHint: "現在のプロジェクト範囲の公開証明書と通常のアップロード。", privateHint: "現在のプロジェクト範囲のプライベート CA 発行証明書。", clearCa: "CA フィルターを解除", currentRange: "現在のプロジェクト · 公開 + プライベート", allProjectServices: "全プロジェクトのサービスを表示" },
  ko: { allProjects: "모든 프로젝트", certificates: "프로젝트 인증서", infrastructure: "발급 인프라", sharedGroups: "공인·사설 인증서가 그룹을 공유합니다", projectHint: "프로젝트 선택 후 인증서 유형을 선택하세요. 왼쪽 개수는 두 유형의 합계입니다.", rootsHint: "루트 CA는 프로젝트와 독립적인 공용 발급 리소스입니다. 서비스 인증서는 프로젝트에 속하며 발급 CA와 연결됩니다.", publicHint: "현재 프로젝트 범위의 공인 인증서 및 일반 업로드입니다.", privateHint: "현재 프로젝트 범위의 사설 CA 서비스 인증서입니다.", clearCa: "CA 필터 해제", currentRange: "현재 프로젝트 · 공인 + 사설", allProjectServices: "전체 프로젝트 서비스 보기" },
};
const selection = {
  "zh-CN": { chooseProject: "请选择项目分组", chooseProjectHint: "在左侧选择一个分组，查看和管理该项目的证书。", noGroups: "暂无项目分组", noGroupsHint: "先创建项目分组，再上传或申请证书。", caServices: "根 CA 服务证书" },
  "zh-TW": { chooseProject: "請選擇專案分組", chooseProjectHint: "在左側選擇分組，查看和管理該專案的憑證。", noGroups: "尚無專案分組", noGroupsHint: "先建立專案分組，再上傳或申請憑證。", caServices: "根 CA 服務憑證" },
  en: { chooseProject: "Select a project group", chooseProjectHint: "Choose a group in the sidebar to view and manage its certificates.", noGroups: "No project groups yet", noGroupsHint: "Create a project group before uploading or requesting certificates.", caServices: "Root CA service certificates" },
  ja: { chooseProject: "プロジェクトグループを選択", chooseProjectHint: "左側のグループを選択して証明書を管理します。", noGroups: "プロジェクトグループがありません", noGroupsHint: "証明書のアップロードや申請の前にグループを作成してください。", caServices: "ルート CA のサービス証明書" },
  ko: { chooseProject: "프로젝트 그룹 선택", chooseProjectHint: "왼쪽에서 그룹을 선택하여 인증서를 관리하세요.", noGroups: "프로젝트 그룹이 없습니다", noGroupsHint: "인증서를 업로드하거나 신청하기 전에 그룹을 만드세요.", caServices: "루트 CA 서비스 인증서" },
};
export function navigationMessages(language: Language) { return { ...translations[language], ...selection[language] }; }
