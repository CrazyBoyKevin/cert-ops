export type CertificateExportContents = {
  certificatePem: string;
  privateKey: string;
};

export function certificateExportNames(primaryDomain: string) {
  const baseName = primaryDomain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9._-]/g, "-") || "certificate";
  return {
    certificatePem: `${baseName}.pem`,
    privateKey: `${baseName}.key`,
    archive: `${baseName}.keys.zip`,
  };
}

export function certificateExportFiles(primaryDomain: string, contents: CertificateExportContents) {
  const names = certificateExportNames(primaryDomain);
  return [
    { name: names.certificatePem, data: contents.certificatePem },
    { name: names.privateKey, data: contents.privateKey },
  ];
}
