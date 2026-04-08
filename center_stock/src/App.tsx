import { type ChangeEvent, type CSSProperties, type FormEvent, useEffect, useState } from "react";
import {
  createCentralDesignation,
  createCentralBestSelling,
  createCentralShop,
  createCentralWorkLocation,
  createCentralWorker,
  deleteCentralBestSelling,
  deleteCentralShop,
  deleteCentralWorker,
  getCentralDesignations,
  getCentralDashboard,
  getCentralDashboardShopDetail,
  getCentralBestSelling,
  getCentralReverseSyncSettings,
  getCentralShops,
  getCentralWorkLocations,
  getCentralWorkers,
  getMasterProducts,
  updateCentralReverseSyncSettings,
  updateCentralShop,
  updateCentralWorker,
} from "./api";
import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
} from "./config/env";
import type {
  BestSellingProduct,
  CentralDashboardResponse,
  CentralDashboardShop,
  CentralDashboardShopDetailResponse,
  CentralReverseSyncSettings,
  CentralShopEndpoint,
  DashboardMetrics,
  MasterProduct,
  StockActivityLogResponse,
  StockActivityLogRow,
  StockOverviewLocation,
  StockOverviewMatchedRow,
  StockOverviewMismatchRow,
  StockOverviewUncheckedRow,
  Worker,
  WorkerLookupRow,
  WorkerPayload,
} from "./types";

type ShopFormState = {
  shopName: string;
  baseUrl: string;
  active: boolean;
};

const EMPTY_FORM: ShopFormState = {
  shopName: "",
  baseUrl: "",
  active: true,
};

type WorkerFormState = {
  name: string;
  fatherName: string;
  designationName: string;
  dateOfBirth: string;
  dateOfJoining: string;
  dateOfResignation: string;
  permanentAddress: string;
  temporaryAddress: string;
  aadhaarNumber: string;
  email: string;
  bankAccountNumber: string;
  ifscCode: string;
  recommendedBy: string;
  workLocationName: string;
  profileImage: UploadedAsset | null;
  resumeFile: UploadedAsset | null;
  aadhaarImage: UploadedAsset | null;
  phoneNumbers: PhoneNumberFormRow[];
  otherProofs: DocumentFormRow[];
  additionalDetails: DocumentFormRow[];
  active: boolean;
};

type UploadedAsset = {
  base64: string;
  mimeType: string;
  fileName: string;
};

type PhoneNumberFormRow = {
  id: string;
  label: string;
  phoneNumber: string;
  isPrimary: boolean;
};

type DocumentFormRow = {
  id: string;
  category: "otherProof" | "additionalDetail";
  label: string;
  textValue: string;
  fileName: string;
  mimeType: string;
  fileDataBase64: string;
};

type ActivePage = "dashboard" | "ports" | "operators" | "best-selling";

type RouteState = {
  page: ActivePage;
  shopId: number | null;
};

type ShopTheme = {
  accent: string;
  soft: string;
  border: string;
};

type OperatorOverviewLocation = NonNullable<CentralDashboardShopDetailResponse["operatorOverview"]>["locations"][number];

function getActivePageFromUrl(): ActivePage {
  if (typeof window === "undefined") return "dashboard";
  const rawHash = String(window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
  if (rawHash === "ports") return "ports";
  if (rawHash === "operators") return "operators";
  if (rawHash === "best-selling") return "best-selling";
  return "dashboard";
}

function getRouteFromUrl(): RouteState {
  if (typeof window === "undefined") {
    return { page: "dashboard", shopId: null };
  }

  const rawHash = String(window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
  if (rawHash.startsWith("shop/")) {
    const shopId = Number(rawHash.split("/")[1] || "");
    if (Number.isFinite(shopId) && shopId > 0) {
      return { page: "dashboard", shopId: Math.trunc(shopId) };
    }
  }

  return {
    page: getActivePageFromUrl(),
    shopId: null,
  };
}

function buildHashForRoute(route: RouteState) {
  if (route.shopId) {
    return `#shop/${route.shopId}`;
  }
  return `#${route.page}`;
}

const EMPTY_WORKER_FORM: WorkerFormState = {
  name: "",
  fatherName: "",
  designationName: "",
  dateOfBirth: "",
  dateOfJoining: "",
  dateOfResignation: "",
  permanentAddress: "",
  temporaryAddress: "",
  aadhaarNumber: "",
  email: "",
  bankAccountNumber: "",
  ifscCode: "",
  recommendedBy: "Direct",
  workLocationName: "",
  profileImage: null,
  resumeFile: null,
  aadhaarImage: null,
  phoneNumbers: [],
  otherProofs: [],
  additionalDetails: [],
  active: true,
};

const SHOP_THEMES: ShopTheme[] = [
  { accent: "#2f6f62", soft: "#edf7f3", border: "#b7d7cb" },
  { accent: "#9a5b21", soft: "#fff3e7", border: "#e8c8a6" },
  { accent: "#355c9b", soft: "#eef4ff", border: "#bfd0f0" },
  { accent: "#7b4a91", soft: "#f6effa", border: "#d7c0e4" },
  { accent: "#a04b5e", soft: "#fdf0f3", border: "#ebbec8" },
  { accent: "#5f6b2f", soft: "#f4f8e8", border: "#d6dfae" },
  { accent: "#226a86", soft: "#ebf8fc", border: "#b5dce8" },
  { accent: "#8e4c36", soft: "#fbefe9", border: "#e3c3b6" },
];

function createFormId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPhoneRow(overrides: Partial<PhoneNumberFormRow> = {}): PhoneNumberFormRow {
  return {
    id: createFormId("phone"),
    label: "",
    phoneNumber: "",
    isPrimary: false,
    ...overrides,
  };
}

function createDocumentRow(
  category: "otherProof" | "additionalDetail",
  overrides: Partial<DocumentFormRow> = {}
): DocumentFormRow {
  return {
    id: createFormId(category),
    category,
    label: "",
    textValue: "",
    fileName: "",
    mimeType: "",
    fileDataBase64: "",
    ...overrides,
  };
}

function createEmptyWorkerForm(): WorkerFormState {
  return {
    ...EMPTY_WORKER_FORM,
    phoneNumbers: [createPhoneRow({ label: "Primary", isPrimary: true })],
    otherProofs: [createDocumentRow("otherProof")],
    additionalDetails: [createDocumentRow("additionalDetail")],
  };
}

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function assetToDataUrl(asset: UploadedAsset | null) {
  if (!asset?.base64) return "";
  return `data:${asset.mimeType || "application/octet-stream"};base64,${asset.base64}`;
}

function fileDataToUrl(base64?: string | null, mimeType?: string | null) {
  if (!base64) return "";
  return `data:${mimeType || "application/octet-stream"};base64,${base64}`;
}

function fileToAsset(file: File): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({
        base64,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      });
    };
    reader.readAsDataURL(file);
  });
}

function normalizeWorkerForForm(worker: Worker): WorkerFormState {
  return {
    name: worker.name || "",
    fatherName: worker.fatherName || "",
    designationName: worker.designationName || "",
    dateOfBirth: toDateInputValue(worker.dateOfBirth),
    dateOfJoining: toDateInputValue(worker.dateOfJoining),
    dateOfResignation: toDateInputValue(worker.dateOfResignation),
    permanentAddress: worker.permanentAddress || "",
    temporaryAddress: worker.temporaryAddress || "",
    aadhaarNumber: worker.aadhaarNumber || "",
    email: worker.email || "",
    bankAccountNumber: worker.bankAccountNumber || "",
    ifscCode: worker.ifscCode || "",
    recommendedBy: worker.recommendedBy || "Direct",
    workLocationName: worker.workLocationName || "",
    profileImage: worker.profileImageBase64
      ? {
          base64: worker.profileImageBase64,
          mimeType: worker.profileImageMimeType || "image/jpeg",
          fileName: worker.profileImageFileName || "profile-image",
        }
      : null,
    resumeFile: worker.resumeFileBase64
      ? {
          base64: worker.resumeFileBase64,
          mimeType: worker.resumeFileMimeType || "application/octet-stream",
          fileName: worker.resumeFileName || "resume",
        }
      : null,
    aadhaarImage: worker.aadhaarImageBase64
      ? {
          base64: worker.aadhaarImageBase64,
          mimeType: worker.aadhaarImageMimeType || "image/jpeg",
          fileName: worker.aadhaarImageFileName || "aadhaar-image",
        }
      : null,
    phoneNumbers:
      worker.phoneNumbers?.length
        ? worker.phoneNumbers.map((row, index) =>
            createPhoneRow({
              label: row.label || "",
              phoneNumber: row.phoneNumber || "",
              isPrimary: index === 0 ? true : Boolean(row.isPrimary),
            })
          )
        : [createPhoneRow({ label: "Primary", phoneNumber: worker.phone || "", isPrimary: true })],
    otherProofs:
      worker.documents?.filter((row) => row.category === "otherProof").length
        ? worker.documents
            .filter((row) => row.category === "otherProof")
            .map((row) =>
              createDocumentRow("otherProof", {
                label: row.label || "",
                textValue: row.textValue || "",
                fileName: row.fileName || "",
                mimeType: row.mimeType || "",
                fileDataBase64: row.fileDataBase64 || "",
              })
            )
        : [createDocumentRow("otherProof")],
    additionalDetails:
      worker.documents?.filter((row) => row.category === "additionalDetail").length
        ? worker.documents
            .filter((row) => row.category === "additionalDetail")
            .map((row) =>
              createDocumentRow("additionalDetail", {
                label: row.label || "",
                textValue: row.textValue || "",
                fileName: row.fileName || "",
                mimeType: row.mimeType || "",
                fileDataBase64: row.fileDataBase64 || "",
              })
            )
        : [createDocumentRow("additionalDetail")],
    active: worker.active,
  };
}

function validateWorkerForm(form: WorkerFormState) {
  if (!form.profileImage?.base64) return "Profile image is required";
  if (!form.name.trim()) return "Name is required";
  if (!form.fatherName.trim()) return "Father's name is required";
  if (!form.designationName.trim()) return "Designation is required";
  if (!form.dateOfBirth) return "Date of birth is required";
  if (!form.dateOfJoining) return "Date of joining is required";
  if (!form.resumeFile?.base64) return "Resume file is required";
  if (!form.permanentAddress.trim()) return "Permanent address is required";
  if (!form.aadhaarNumber.trim()) return "Aadhaar number is required";
  if (!form.aadhaarImage?.base64) return "Aadhaar image is required";
  if (!form.phoneNumbers.some((row) => row.phoneNumber.trim())) return "At least one phone number is required";
  if (!form.bankAccountNumber.trim()) return "Bank account number is required";
  if (!form.ifscCode.trim()) return "IFSC code is required";
  if (!form.recommendedBy.trim()) return "Recommended by is required";
  return null;
}

function buildWorkerPayload(form: WorkerFormState): WorkerPayload {
  const phoneNumbers = form.phoneNumbers
    .filter((row) => row.phoneNumber.trim())
    .map((row, index) => ({
      label: row.label.trim() || null,
      phoneNumber: row.phoneNumber.trim(),
      isPrimary: index === 0 ? true : Boolean(row.isPrimary),
    }));

  const otherProofs = form.otherProofs
    .filter((row) => row.label.trim() || row.textValue.trim() || row.fileDataBase64)
    .map((row, index) => ({
      category: "otherProof",
      label: row.label.trim() || null,
      textValue: row.textValue.trim() || null,
      fileName: row.fileName || null,
      mimeType: row.mimeType || null,
      fileDataBase64: row.fileDataBase64 || null,
      sortOrder: index,
      active: true,
    }));

  const additionalDetails = form.additionalDetails
    .filter((row) => row.label.trim() || row.textValue.trim() || row.fileDataBase64)
    .map((row, index) => ({
      category: "additionalDetail",
      label: row.label.trim() || null,
      textValue: row.textValue.trim() || null,
      fileName: row.fileName || null,
      mimeType: row.mimeType || null,
      fileDataBase64: row.fileDataBase64 || null,
      sortOrder: index,
      active: true,
    }));

  return {
    name: form.name.trim(),
    fatherName: form.fatherName.trim(),
    designationName: form.designationName.trim(),
    dateOfBirth: form.dateOfBirth,
    dateOfJoining: form.dateOfJoining,
    dateOfResignation: form.dateOfResignation || null,
    permanentAddress: form.permanentAddress.trim(),
    temporaryAddress: form.temporaryAddress.trim() || null,
    aadhaarNumber: form.aadhaarNumber.trim(),
    email: form.email.trim() || null,
    bankAccountNumber: form.bankAccountNumber.trim(),
    ifscCode: form.ifscCode.trim(),
    recommendedBy: form.recommendedBy.trim() || "Direct",
    workLocationName: form.workLocationName.trim() || null,
    profileImageBase64: form.profileImage?.base64 || "",
    profileImageMimeType: form.profileImage?.mimeType || null,
    profileImageFileName: form.profileImage?.fileName || null,
    resumeFileBase64: form.resumeFile?.base64 || "",
    resumeFileMimeType: form.resumeFile?.mimeType || null,
    resumeFileName: form.resumeFile?.fileName || null,
    aadhaarImageBase64: form.aadhaarImage?.base64 || "",
    aadhaarImageMimeType: form.aadhaarImage?.mimeType || null,
    aadhaarImageFileName: form.aadhaarImage?.fileName || null,
    phoneNumbers,
    documents: [...otherProofs, ...additionalDetails],
    active: form.active,
  };
}

function getShopThemeKey(shop: Pick<CentralDashboardShop, "id" | "shopName" | "registryName" | "baseUrl">) {
  return [shop.shopName, shop.registryName, shop.baseUrl, shop.id].map((value) => normalizeText(value)).join("|");
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getShopTheme(shop: Pick<CentralDashboardShop, "id" | "shopName" | "registryName" | "baseUrl">) {
  const key = getShopThemeKey(shop);
  return SHOP_THEMES[hashText(key) % SHOP_THEMES.length];
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M19.14 12.94a7.96 7.96 0 0 0 .06-.94 7.96 7.96 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.74 7.74 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42L9.2 5.32c-.58.22-1.12.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.66 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94 0 .32.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.24.1.51.01.64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatSignedCurrency(value: number) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return "0.00";
  const absolute = Math.abs(numeric).toFixed(2);
  return numeric > 0 ? `+${absolute}` : `-${absolute}`;
}

function formatSignedBottles(value: number) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return "0";
  return numeric > 0 ? `+${numeric}` : `${numeric}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function buildProductSearchText(product: {
  itemCode?: string | null;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  barcode?: string | null;
}) {
  return [
    product.itemCode,
    product.itemName,
    product.brandName,
    product.packValue,
    product.barcode,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");
}

function getEventStatusLabel(log: StockActivityLogRow) {
  if (log.matched === true) return "Matched";
  if (log.matched === false || log.diffBottles !== 0) return "Mismatch";
  return "Updated";
}

function formatEventActionLabel(log: StockActivityLogRow) {
  const scope = String(log.eventScope || "").trim();
  const action = String(log.eventAction || "").trim();
  return [scope, action].filter(Boolean).join(" / ") || "-";
}

function splitSearchTokens(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesSearchTokens(tokens: string[], fields: unknown[]) {
  if (!tokens.length) return true;
  const haystack = fields
    .map((field) => normalizeText(field))
    .filter(Boolean)
    .join(" ");
  return tokens.every((token) => haystack.includes(token));
}

function getEventActionKey(log: Pick<StockActivityLogRow, "eventScope" | "eventAction">) {
  return `${normalizeText(log.eventScope)}|${normalizeText(log.eventAction)}`;
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  return (
    <div className={`summary-stat summary-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryPanel({
  title,
  subtitle,
  metrics,
}: {
  title: string;
  subtitle: string;
  metrics: DashboardMetrics | null | undefined;
}) {
  if (!metrics) {
    return (
      <section className="metric-panel">
        <div className="metric-panel-header">
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
        <div className="metric-panel-empty">No summary available.</div>
      </section>
    );
  }

  return (
    <section className="metric-panel">
      <div className="metric-panel-header">
        <h4>{title}</h4>
        <p>{subtitle}</p>
      </div>
      <div className="metric-panel-grid">
        <SummaryStat label="Matched" value={metrics.matchedCount} tone="success" />
        <SummaryStat label="Mismatch" value={metrics.mismatchCount} tone="danger" />
        <SummaryStat label="Bottle Diff" value={formatSignedBottles(metrics.totalDiffBottles)} />
        <SummaryStat
          label="Cash Diff"
          value={formatSignedCurrency(metrics.totalDiffValue)}
          tone={metrics.totalDiffValue < 0 ? "danger" : metrics.totalDiffValue > 0 ? "success" : "default"}
        />
      </div>
    </section>
  );
}

function MismatchTable({ rows }: { rows: StockOverviewMismatchRow[] }) {
  if (!rows.length) {
    return <p className="detail-empty">No mismatch rows.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Entered</th>
            <th>Stock</th>
            <th>Diff</th>
            <th>MRP</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.itemCode}-${row.id ?? "na"}-${row.operatorId ?? "na"}`}>
              <td>
                <div className="item-cell">
                  <strong>{row.name}</strong>
                  <span>{row.itemCode}</span>
                </div>
              </td>
              <td>{row.enteredBottles}</td>
              <td>{row.currentStockBottles}</td>
              <td>{row.diffFormatted}</td>
              <td>{row.mrp ?? "-"}</td>
              <td>{row.priceDiffFormatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UncheckedTable({ rows }: { rows: StockOverviewUncheckedRow[] }) {
  if (!rows.length) {
    return <p className="detail-empty">No unchecked rows.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Code</th>
            <th>MRP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.shopLocationId}-${row.itemCode}`}>
              <td>{row.name}</td>
              <td>{row.itemCode}</td>
              <td>{row.mrp ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchedTable({ rows }: { rows: StockOverviewMatchedRow[] }) {
  if (!rows.length) {
    return <p className="detail-empty">No matched rows.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Code</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.itemCode}-${row.name}`}>
              <td>{row.name}</td>
              <td>{row.itemCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScopeDetailAccordion({
  title,
  subtitle,
  location,
  productSectionFilter = "all",
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  location: StockOverviewLocation | null | undefined;
  productSectionFilter?: "all" | "matched" | "mismatch" | "unchecked";
  defaultOpen?: boolean;
}) {
  const showMatched = productSectionFilter === "all" || productSectionFilter === "matched";
  const showMismatch = productSectionFilter === "all" || productSectionFilter === "mismatch";
  const showUnchecked = productSectionFilter === "all" || productSectionFilter === "unchecked";

  return (
    <details className="scope-accordion" open={defaultOpen}>
      <summary className="scope-accordion-summary">
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
        <div className="scope-accordion-summary-metrics">
          <span>Matched {location?.matchedCount ?? 0}</span>
          <span>Mismatch {location?.mismatchCount ?? 0}</span>
        </div>
      </summary>

      {location ? (
        <div className="scope-accordion-content">
          <div className="location-detail-panels">
            <SummaryPanel
              title={title}
              subtitle={subtitle}
              metrics={{
                scannedCount: location.scannedCount,
                trackedCount: location.trackedCount,
                matchedCount: location.matchedCount,
                uncheckedCount: location.uncheckedCount,
                mismatchCount: location.mismatchCount,
                totalDiffBottles: location.totalDiffBottles,
                totalDiffValue: location.totalDiffValue,
                totalDiffValueFormatted: location.totalDiffValueFormatted,
                locationCount: 1,
                operatorCount: location.operatorCount,
              }}
            />
          </div>

          <div className="detail-sections">
            {showMatched ? (
              <details className="detail-accordion" open>
                <summary className="detail-accordion-summary">
                  <span>Matched Products</span>
                  <strong>{location.matchedRows.length}</strong>
                </summary>
                <MatchedTable rows={location.matchedRows} />
              </details>
            ) : null}

            {showMismatch ? (
              <details className="detail-accordion" open>
                <summary className="detail-accordion-summary">
                  <span>Mismatch Products</span>
                  <strong>{location.mismatchRows.length}</strong>
                </summary>
                <MismatchTable rows={location.mismatchRows} />
              </details>
            ) : null}

            {showUnchecked ? (
              <details className="detail-accordion">
                <summary className="detail-accordion-summary">
                  <span>Unchecked Products</span>
                  <strong>{location.uncheckedRows.length}</strong>
                </summary>
                <UncheckedTable rows={location.uncheckedRows} />
              </details>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="scope-accordion-content">
          <p className="detail-empty">No data available.</p>
        </div>
      )}
    </details>
  );
}

function LocationDetailCard({
  location,
  todayLocation,
}: {
  location: StockOverviewLocation;
  todayLocation?: StockOverviewLocation | null;
}) {
  return (
    <article className="location-detail-card">
      <header className="location-detail-header">
        <div>
          <h4>{location.shopLocationLabel}</h4>
          <p>{location.shopLocationName}</p>
        </div>
        <div className="location-detail-summary">
          <span>Today matched: {todayLocation?.matchedCount ?? 0}</span>
          <span>Cycle mismatch: {location.mismatchCount}</span>
        </div>
      </header>

      <div className="scope-accordion-stack">
        <ScopeDetailAccordion
          title="Today"
          subtitle="Today stock by this location"
          location={todayLocation || null}
          defaultOpen
        />
        <ScopeDetailAccordion
          title="Full Cycle"
          subtitle="Full cycle stock by this location"
          location={location}
        />
      </div>
    </article>
  );
}

function toLocationMetrics(location: StockOverviewLocation | null | undefined): DashboardMetrics | null {
  if (!location) return null;
  return {
    scannedCount: location.scannedCount,
    trackedCount: location.trackedCount,
    matchedCount: location.matchedCount,
    uncheckedCount: location.uncheckedCount,
    mismatchCount: location.mismatchCount,
    totalDiffBottles: location.totalDiffBottles,
    totalDiffValue: location.totalDiffValue,
    totalDiffValueFormatted: location.totalDiffValueFormatted,
    locationCount: 1,
    operatorCount: location.operatorCount,
  };
}

function ActivityLogTable({ rows }: { rows: StockActivityLogRow[] }) {
  if (!rows.length) {
    return <p className="detail-empty">No activity logs for this location.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="detail-table activity-log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Operator</th>
            <th>Product</th>
            <th>Action</th>
            <th>Status</th>
            <th>Diff</th>
            <th>Cash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="item-cell">
                  <strong>{row.eventTimeLabel}</strong>
                  <span>{row.activityDate || "-"}</span>
                </div>
              </td>
              <td>
                <div className="item-cell">
                  <strong>{row.operatorName || "-"}</strong>
                  <span>{row.phoneName || "No phone"}</span>
                </div>
              </td>
              <td>
                <div className="item-cell">
                  <strong>{row.name}</strong>
                  <span>{row.itemCode}</span>
                </div>
              </td>
              <td>
                <div className="item-cell">
                  <strong>{formatEventActionLabel(row)}</strong>
                  <span>{row.changeSummary || "No extra changes"}</span>
                </div>
              </td>
              <td>{getEventStatusLabel(row)}</td>
              <td>{row.diffFormatted}</td>
              <td>{row.priceDiffFormatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperatorLocationSection({
  location,
}: {
  location: NonNullable<CentralDashboardShopDetailResponse["operatorOverview"]>["locations"][number] | null | undefined;
}) {
  if (!location?.operators.length) {
    return <p className="detail-empty">No operator activity for this location.</p>;
  }

  return (
    <div className="operator-card-grid">
      {location.operators.map((operator) => (
        <article key={`${location.shopLocationId}-${operator.operatorId}`} className="operator-card">
          <header>
            <h5>{operator.operatorName}</h5>
            <p>
              Scanned {operator.scannedCount} · Matched {operator.matchedCount} · Mismatch {operator.mismatchCount}
            </p>
          </header>
          <div className="operator-metric-row">
            <SummaryStat label="Bottle Diff" value={formatSignedBottles(operator.totalDiffBottles)} />
            <SummaryStat
              label="Cash Diff"
              value={formatSignedCurrency(operator.totalDiffValue)}
              tone={operator.totalDiffValue < 0 ? "danger" : operator.totalDiffValue > 0 ? "success" : "default"}
            />
          </div>
          <details className="detail-accordion" open={operator.mismatchCount > 0}>
            <summary className="detail-accordion-summary">
              <span>Mismatched products</span>
              <strong>{operator.rows.length}</strong>
            </summary>
            <MismatchTable rows={operator.rows} />
          </details>
        </article>
      ))}
    </div>
  );
}

function ShopLocationDetailSection({
  location,
  todayLocation,
  operatorLocation,
  activityLocation,
  productSectionFilter = "all",
  defaultOpen = false,
}: {
  location: StockOverviewLocation;
  todayLocation?: StockOverviewLocation | null;
  operatorLocation?: NonNullable<CentralDashboardShopDetailResponse["operatorOverview"]>["locations"][number] | null;
  activityLocation?: NonNullable<StockActivityLogResponse["locations"]>[number] | null;
  productSectionFilter?: "all" | "matched" | "mismatch" | "unchecked";
  defaultOpen?: boolean;
}) {
  return (
    <details className="location-page-section" open={defaultOpen}>
      <summary className="location-page-summary">
        <div>
          <h3>{location.shopLocationLabel}</h3>
          <p>{location.shopLocationName}</p>
        </div>
        <div className="location-page-summary-metrics">
          <span>Today mismatch {todayLocation?.mismatchCount ?? 0}</span>
          <span>Cycle mismatch {location.mismatchCount}</span>
          <span>Operators {location.operatorCount}</span>
          <span>Logs {activityLocation?.logCount ?? 0}</span>
        </div>
      </summary>

      <div className="location-page-body">
        <div className="shop-summary-grid">
          <SummaryPanel
            title="Today"
            subtitle="Today stock by this location"
            metrics={toLocationMetrics(todayLocation || null)}
          />
          <SummaryPanel
            title="Full Cycle"
            subtitle="Whole cycle stock by this location"
            metrics={toLocationMetrics(location)}
          />
        </div>

        <section className="detail-subsection">
          <div className="detail-subsection-heading">
            <div>
              <p className="section-kicker">Products</p>
              <h4>Location stock detail</h4>
            </div>
          </div>
          <div className="scope-accordion-stack">
            <ScopeDetailAccordion
              title="Today"
              subtitle="Today product status"
              location={todayLocation || null}
              productSectionFilter={productSectionFilter}
              defaultOpen
            />
            <ScopeDetailAccordion
              title="Full Cycle"
              subtitle="Cycle product status"
              location={location}
              productSectionFilter={productSectionFilter}
            />
          </div>
        </section>

        <section className="detail-subsection">
          <div className="detail-subsection-heading">
            <div>
              <p className="section-kicker">Operators</p>
              <h4>Who scanned and where mismatch happened</h4>
            </div>
          </div>
          <OperatorLocationSection location={operatorLocation} />
        </section>

        <section className="detail-subsection">
          <div className="detail-subsection-heading">
            <div>
              <p className="section-kicker">Logs</p>
              <h4>Scan activity log</h4>
            </div>
          </div>
          <div className="detail-log-summary">
            <SummaryStat label="Logs" value={activityLocation?.logCount ?? 0} />
            <SummaryStat label="Operators" value={activityLocation?.operatorsTouched ?? 0} />
            <SummaryStat label="Matched" value={activityLocation?.matchedCount ?? 0} tone="success" />
            <SummaryStat label="Mismatch" value={activityLocation?.mismatchCount ?? 0} tone="danger" />
          </div>
          <details className="detail-accordion" open>
            <summary className="detail-accordion-summary">
              <span>Activity log rows</span>
              <strong>{activityLocation?.logs.length ?? 0}</strong>
            </summary>
            <ActivityLogTable rows={activityLocation?.logs || []} />
          </details>
        </section>
      </div>
    </details>
  );
}

function ShopDetailPage({
  shop,
  detail,
  loading,
  onBack,
}: {
  shop: CentralDashboardShop | null;
  detail: CentralDashboardShopDetailResponse | null;
  loading: boolean;
  onBack: () => void;
}) {
  const [searchText, setSearchText] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [productSectionFilter, setProductSectionFilter] = useState<"all" | "matched" | "mismatch" | "unchecked">(
    "all"
  );
  const [logResultFilter, setLogResultFilter] = useState<"all" | "matched" | "mismatch">("all");

  useEffect(() => {
    setSearchText("");
    setLocationFilter("all");
    setOperatorFilter("all");
    setActionFilter("all");
    setProductSectionFilter("all");
    setLogResultFilter("all");
  }, [shop?.id, detail?.shop.id]);

  const overview = detail?.overview;
  const queryTokens = splitSearchTokens(searchText);
  const selectedLocationId = locationFilter === "all" ? null : Number(locationFilter);
  const selectedOperatorId = operatorFilter === "all" ? null : Number(operatorFilter);

  const todayLocationsById = new Map(
    (overview?.today?.locations || []).map((row) => [row.shopLocationId, row])
  );
  const operatorsByLocationId = new Map(
    (detail?.operatorOverview?.locations || []).map((row) => [row.shopLocationId, row])
  );
  const logsByLocationId = new Map(
    (detail?.activityLogs?.locations || []).map((row) => [row.shopLocationId, row])
  );

  const operatorOptions = Array.from(
    ((detail?.operatorOverview?.locations || []).flatMap((locationRow) =>
      locationRow.operators.map((operator) => [operator.operatorId, operator.operatorName] as const)
    )).reduce((map, [id, name]) => map.set(id, name), new Map<number, string>())
  )
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const actionOptions = Array.from(
    ((detail?.activityLogs?.locations || []).flatMap((locationRow) => locationRow.logs)).reduce((map, log) => {
      const key = getEventActionKey(log);
      const label = formatEventActionLabel(log);
      if (key && !map.has(key)) {
        map.set(key, label);
      }
      return map;
    }, new Map<string, string>())
  )
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rebuildFilteredLocation = (
    base: StockOverviewLocation,
    matchedRows: StockOverviewMatchedRow[],
    mismatchRows: StockOverviewMismatchRow[],
    uncheckedRows: StockOverviewUncheckedRow[]
  ): StockOverviewLocation => {
    const totalDiffBottles = mismatchRows.reduce((sum, row) => sum + (Number(row.diffBottles) || 0), 0);
    const totalDiffValue = mismatchRows.reduce((sum, row) => sum + (Number(row.priceDiff) || 0), 0);
    return {
      ...base,
      matchedRows,
      mismatchRows,
      uncheckedRows,
      matchedCount: matchedRows.length,
      mismatchCount: mismatchRows.length,
      uncheckedCount: uncheckedRows.length,
      scannedCount: matchedRows.length + mismatchRows.length,
      trackedCount: matchedRows.length + mismatchRows.length + uncheckedRows.length,
      totalDiffBottles,
      totalDiffValue,
      totalDiffValueFormatted: formatSignedCurrency(totalDiffValue),
      positiveDiffValue: mismatchRows.reduce(
        (sum, row) => sum + Math.max(Number(row.priceDiff) || 0, 0),
        0
      ),
      negativeDiffValue: mismatchRows.reduce(
        (sum, row) => sum + Math.min(Number(row.priceDiff) || 0, 0),
        0
      ),
    };
  };

  const filteredLocationEntries = (overview?.locations || [])
    .map((location) => {
      if (selectedLocationId != null && location.shopLocationId !== selectedLocationId) {
        return null;
      }

      const todayLocation = todayLocationsById.get(location.shopLocationId) || null;
      const operatorLocation = operatorsByLocationId.get(location.shopLocationId) || null;
      const activityLocation = logsByLocationId.get(location.shopLocationId) || null;

      const filteredCycleLocation = rebuildFilteredLocation(
        location,
        location.matchedRows.filter((row) =>
          matchesSearchTokens(queryTokens, [row.name, row.itemCode, location.shopLocationName, location.shopLocationLabel])
        ),
        location.mismatchRows.filter((row) => {
          if (selectedOperatorId != null && Number(row.operatorId || 0) !== selectedOperatorId) return false;
          return matchesSearchTokens(queryTokens, [
            row.name,
            row.itemCode,
            row.itemName,
            row.brandName,
            row.packValue,
            row.diffBottles,
            row.priceDiff,
            row.updatedAt,
            row.operatorId,
            location.shopLocationName,
            location.shopLocationLabel,
          ]);
        }),
        location.uncheckedRows.filter((row) =>
          matchesSearchTokens(queryTokens, [
            row.name,
            row.itemCode,
            row.itemName,
            row.brandName,
            row.packValue,
            row.mrp,
            location.shopLocationName,
            location.shopLocationLabel,
          ])
        )
      );

      const filteredTodayLocation = todayLocation
        ? rebuildFilteredLocation(
            todayLocation,
            todayLocation.matchedRows.filter((row) =>
              matchesSearchTokens(queryTokens, [
                row.name,
                row.itemCode,
                todayLocation.shopLocationName,
                todayLocation.shopLocationLabel,
              ])
            ),
            todayLocation.mismatchRows.filter((row) => {
              if (selectedOperatorId != null && Number(row.operatorId || 0) !== selectedOperatorId) return false;
              return matchesSearchTokens(queryTokens, [
                row.name,
                row.itemCode,
                row.itemName,
                row.brandName,
                row.packValue,
                row.diffBottles,
                row.priceDiff,
                row.updatedAt,
                row.operatorId,
                todayLocation.shopLocationName,
                todayLocation.shopLocationLabel,
              ]);
            }),
            todayLocation.uncheckedRows.filter((row) =>
              matchesSearchTokens(queryTokens, [
                row.name,
                row.itemCode,
                row.itemName,
                row.brandName,
                row.packValue,
                row.mrp,
                todayLocation.shopLocationName,
                todayLocation.shopLocationLabel,
              ])
            )
          )
        : null;

      let filteredOperatorLocation: OperatorOverviewLocation | null = null;
      if (operatorLocation) {
        const filteredOperators = operatorLocation.operators.reduce<OperatorOverviewLocation["operators"]>(
          (acc, operator) => {
            if (selectedOperatorId != null && operator.operatorId !== selectedOperatorId) return acc;
            const filteredRows = operator.rows.filter((row) =>
              matchesSearchTokens(queryTokens, [
                operator.operatorName,
                operator.operatorId,
                row.name,
                row.itemCode,
                row.itemName,
                row.brandName,
                row.packValue,
                row.diffBottles,
                row.priceDiff,
                row.updatedAt,
                location.shopLocationName,
                location.shopLocationLabel,
              ])
            );
            const operatorTextMatch = matchesSearchTokens(queryTokens, [
              operator.operatorName,
              operator.operatorId,
              location.shopLocationName,
              location.shopLocationLabel,
            ]);
            if (queryTokens.length && filteredRows.length === 0 && !operatorTextMatch) return acc;

            const totalDiffBottles = filteredRows.reduce((sum, row) => sum + (Number(row.diffBottles) || 0), 0);
            const totalDiffValue = filteredRows.reduce((sum, row) => sum + (Number(row.priceDiff) || 0), 0);
            acc.push({
              ...operator,
              rows: filteredRows,
              mismatchCount: filteredRows.length,
              totalDiffBottles,
              totalDiffValue,
              totalDiffValueFormatted: formatSignedCurrency(totalDiffValue),
            });
            return acc;
          },
          []
        );
        filteredOperatorLocation = {
          ...operatorLocation,
          operators: filteredOperators,
        };
      }

      const filteredActivityLocation = activityLocation
        ? (() => {
            const logs = activityLocation.logs.filter((row) => {
              if (selectedOperatorId != null && Number(row.operatorId || 0) !== selectedOperatorId) return false;
              if (actionFilter !== "all" && getEventActionKey(row) !== actionFilter) return false;
              if (logResultFilter === "matched" && row.matched !== true) return false;
              if (logResultFilter === "mismatch" && !(row.matched === false || Number(row.diffBottles || 0) !== 0)) {
                return false;
              }
              return matchesSearchTokens(queryTokens, [
                row.operatorName,
                row.operatorId,
                row.phoneName,
                row.itemCode,
                row.itemName,
                row.brandName,
                row.packValue,
                row.eventScope,
                row.eventAction,
                row.changeSummary,
                row.diffBottles,
                row.priceDiff,
                row.activityDate,
                row.eventTimeLabel,
                location.shopLocationName,
                location.shopLocationLabel,
              ]);
            });
            const matchedCount = logs.filter((row) => row.matched === true).length;
            const mismatchCount = logs.filter(
              (row) => row.matched === false || Number(row.diffBottles || 0) !== 0
            ).length;
            const totalDiffBottles = logs.reduce((sum, row) => sum + (Number(row.diffBottles) || 0), 0);
            const totalDiffValue = logs.reduce((sum, row) => sum + (Number(row.priceDiff) || 0), 0);
            const operatorsTouched = new Set(
              logs
                .map((row) => Number(row.operatorId || 0))
                .filter((operatorId) => Number.isFinite(operatorId) && operatorId > 0)
            ).size;
            return {
              ...activityLocation,
              logs,
              logCount: logs.length,
              operatorsTouched,
              matchedCount,
              mismatchCount,
              totalDiffBottles,
              totalDiffValue,
              totalDiffValueFormatted: formatSignedCurrency(totalDiffValue),
            };
          })()
        : null;

      const hasVisibleRows =
        filteredCycleLocation.matchedRows.length > 0 ||
        filteredCycleLocation.mismatchRows.length > 0 ||
        filteredCycleLocation.uncheckedRows.length > 0 ||
        (filteredTodayLocation?.matchedRows.length || 0) > 0 ||
        (filteredTodayLocation?.mismatchRows.length || 0) > 0 ||
        (filteredTodayLocation?.uncheckedRows.length || 0) > 0 ||
        (filteredOperatorLocation?.operators.length || 0) > 0 ||
        (filteredActivityLocation?.logs.length || 0) > 0;

      const hasFilterApplied =
        queryTokens.length > 0 ||
        selectedOperatorId != null ||
        actionFilter !== "all" ||
        logResultFilter !== "all" ||
        productSectionFilter !== "all";
      if (hasFilterApplied && !hasVisibleRows) {
        return null;
      }

      return {
        location: filteredCycleLocation,
        todayLocation: filteredTodayLocation,
        operatorLocation: filteredOperatorLocation,
        activityLocation: filteredActivityLocation,
      };
    })
    .filter(Boolean) as Array<{
    location: StockOverviewLocation;
    todayLocation: StockOverviewLocation | null;
    operatorLocation: OperatorOverviewLocation | null;
    activityLocation: NonNullable<StockActivityLogResponse["locations"]>[number] | null;
  }>;

  return (
    <section className="section-card detail-page-shell">
      <div className="detail-page-back-row">
        <button className="ghost-button detail-back-button" type="button" onClick={onBack}>
          ← Back to dashboard
        </button>
      </div>

      <header className="detail-page-header">
        <div>
          <p className="section-kicker">Shop Detail</p>
          <h2>{shop?.shopName || detail?.shop.shopName || detail?.shop.registryName || "Shop"}</h2>
          <p className="detail-page-subtitle">
            {shop?.baseUrl || detail?.shop.baseUrl || ""}
          </p>
          {overview?.cycle ? (
            <p className="detail-page-cycle">
              {overview.cycle.currentCycle ? "Current" : "Latest"} cycle {overview.cycle.sno ?? "-"} ·{" "}
              {overview.cycle.cycleDate}
            </p>
          ) : null}
        </div>
        <div className="detail-page-status">
          <span className={`status-pill status-${shop?.status || detail?.status || "offline"}`}>
            {shop?.status || detail?.status || "offline"}
          </span>
        </div>
      </header>

      {loading ? <p className="detail-empty">Loading full shop details...</p> : null}
      {!loading && detail?.status === "offline" ? (
        <div className="shop-error">{detail.message || "Unable to load this shop detail."}</div>
      ) : null}
      {!loading && !detail ? <p className="detail-empty">No detail loaded for this shop.</p> : null}

      {!loading && detail?.status === "online" && overview ? (
        <>
          <section className="detail-filter-panel">
            <div className="detail-filter-grid">
              <label className="detail-filter-field detail-filter-field-search">
                <span>Search</span>
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search items, codes, operators, logs, action, pack..."
                />
              </label>

              <label className="detail-filter-field">
                <span>Location</span>
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                  <option value="all">All locations</option>
                  {overview.locations.map((location) => (
                    <option key={location.shopLocationId} value={String(location.shopLocationId)}>
                      {location.shopLocationLabel} - {location.shopLocationName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="detail-filter-field">
                <span>Operator</span>
                <select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}>
                  <option value="all">All operators</option>
                  {operatorOptions.map((operator) => (
                    <option key={operator.id} value={String(operator.id)}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="detail-filter-field">
                <span>Product Rows</span>
                <select
                  value={productSectionFilter}
                  onChange={(event) =>
                    setProductSectionFilter(event.target.value as "all" | "matched" | "mismatch" | "unchecked")
                  }
                >
                  <option value="all">All</option>
                  <option value="matched">Matched only</option>
                  <option value="mismatch">Mismatch only</option>
                  <option value="unchecked">Unchecked only</option>
                </select>
              </label>

              <label className="detail-filter-field">
                <span>Log Action</span>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                  <option value="all">All actions</option>
                  {actionOptions.map((action) => (
                    <option key={action.key} value={action.key}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="detail-filter-field">
                <span>Log Result</span>
                <select
                  value={logResultFilter}
                  onChange={(event) => setLogResultFilter(event.target.value as "all" | "matched" | "mismatch")}
                >
                  <option value="all">All</option>
                  <option value="matched">Matched</option>
                  <option value="mismatch">Mismatch</option>
                </select>
              </label>
            </div>
            <div className="detail-filter-actions">
              <p>
                Showing <strong>{filteredLocationEntries.length}</strong> of{" "}
                <strong>{overview.locations.length}</strong> locations
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setSearchText("");
                  setLocationFilter("all");
                  setOperatorFilter("all");
                  setActionFilter("all");
                  setProductSectionFilter("all");
                  setLogResultFilter("all");
                }}
              >
                Clear Filters
              </button>
            </div>
          </section>

          <div className="top-metrics-grid detail-top-metrics">
            <SummaryStat label="Today Matched" value={overview.today?.summary.matchedCount ?? 0} tone="success" />
            <SummaryStat label="Today Mismatch" value={overview.today?.summary.mismatchCount ?? 0} tone="danger" />
            <SummaryStat
              label="Today Bottle Diff"
              value={formatSignedBottles(overview.today?.summary.totalDiffBottles ?? 0)}
            />
            <SummaryStat
              label="Cycle Matched"
              value={overview.summary.matchedCount}
              tone="success"
            />
            <SummaryStat
              label="Cycle Mismatch"
              value={overview.summary.mismatchCount}
              tone="danger"
            />
            <SummaryStat
              label="Cycle Bottle Diff"
              value={formatSignedBottles(overview.summary.totalDiffBottles)}
            />
            <SummaryStat
              label="Cycle Cash Diff"
              value={formatSignedCurrency(overview.summary.totalDiffValue)}
              tone={overview.summary.totalDiffValue < 0 ? "danger" : "default"}
            />
          </div>

          <div className="location-page-stack">
            {filteredLocationEntries.map((entry, index) => (
              <ShopLocationDetailSection
                key={`shop-detail-${entry.location.shopLocationId}`}
                location={entry.location}
                todayLocation={entry.todayLocation}
                operatorLocation={entry.operatorLocation}
                activityLocation={entry.activityLocation}
                productSectionFilter={productSectionFilter}
                defaultOpen={index === 0}
              />
            ))}
            {filteredLocationEntries.length === 0 ? (
              <p className="detail-empty">No rows match current filters.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<CentralDashboardResponse | null>(null);
  const [shops, setShops] = useState<CentralShopEndpoint[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [designations, setDesignations] = useState<WorkerLookupRow[]>([]);
  const [workLocations, setWorkLocations] = useState<WorkerLookupRow[]>([]);
  const [bestSellingRows, setBestSellingRows] = useState<BestSellingProduct[]>([]);
  const [masterProducts, setMasterProducts] = useState<MasterProduct[]>([]);
  const [reverseSyncSettings, setReverseSyncSettings] = useState<CentralReverseSyncSettings>({
    reverseSyncOperatorsEnabled: true,
    reverseSyncBestSellingEnabled: true,
  });
  const [savedReverseSyncSettings, setSavedReverseSyncSettings] = useState<CentralReverseSyncSettings>({
    reverseSyncOperatorsEnabled: true,
    reverseSyncBestSellingEnabled: true,
  });
  const [detailByShopId, setDetailByShopId] = useState<Record<number, CentralDashboardShopDetailResponse>>({});
  const [openShopIds, setOpenShopIds] = useState<Record<number, boolean>>({});
  const [detailLoadingByShopId, setDetailLoadingByShopId] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workerSaving, setWorkerSaving] = useState(false);
  const [bestSellingSaving, setBestSellingSaving] = useState(false);
  const [reverseSyncSaving, setReverseSyncSaving] = useState(false);
  const [editingShopId, setEditingShopId] = useState<number | null>(null);
  const [form, setForm] = useState<ShopFormState>(EMPTY_FORM);
  const [editingWorkerId, setEditingWorkerId] = useState<number | null>(null);
  const [viewingWorker, setViewingWorker] = useState<Worker | null>(null);
  const [workerForm, setWorkerForm] = useState<WorkerFormState>(() => createEmptyWorkerForm());
  const [workerListQuery, setWorkerListQuery] = useState("");
  const [newDesignationName, setNewDesignationName] = useState("");
  const [newWorkLocationName, setNewWorkLocationName] = useState("");
  const [bestSellingQuery, setBestSellingQuery] = useState("");
  const [bestSellingListQuery, setBestSellingListQuery] = useState("");
  const [backendUrlInput, setBackendUrlInput] = useState("");
  const [currentBackendUrl, setCurrentBackendUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [route, setRoute] = useState<RouteState>(() => getRouteFromUrl());
  const activePage = route.page;
  const selectedShopId = route.shopId;

  function reloadBackendUrl() {
    const backend = getApiBaseUrl();
    setBackendUrlInput(backend);
    setCurrentBackendUrl(backend);
  }

  async function loadDashboard() {
    setLoading(true);
    try {
      const result = await getCentralDashboard();
      setDashboard(result);
      setOpenShopIds((current) => {
        const nextState = { ...current };
        for (const shop of result.shops) {
          if (!(shop.id in nextState)) {
            nextState[shop.id] = true;
          }
        }
        return nextState;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function loadShops() {
    setSettingsLoading(true);
    try {
      const [shopRows, workerRows, bestSellingData, reverseSettings, masterRows, designationRows, workLocationRows] =
        await Promise.all([
        getCentralShops(true),
        getCentralWorkers(true),
        getCentralBestSelling(true),
        getCentralReverseSyncSettings(),
        getMasterProducts("", 10000),
        getCentralDesignations(true),
        getCentralWorkLocations(true),
      ]);
      setShops(shopRows);
      setWorkers(workerRows);
      setBestSellingRows(bestSellingData);
      setDesignations(designationRows);
      setWorkLocations(workLocationRows);
      setReverseSyncSettings(reverseSettings);
      setSavedReverseSyncSettings(reverseSettings);
      setMasterProducts(masterRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load shop settings");
    } finally {
      setSettingsLoading(false);
    }
  }

  useEffect(() => {
    reloadBackendUrl();
    void Promise.all([loadDashboard(), loadShops()]);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRouteFromUrl());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHash = buildHashForRoute(route);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [route]);

  async function loadShopDetail(shopId: number) {
    setDetailLoadingByShopId((current) => ({ ...current, [shopId]: true }));
    try {
      const detail = await getCentralDashboardShopDetail(shopId);
      setDetailByShopId((current) => ({ ...current, [shopId]: detail }));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Failed to load shop detail");
    } finally {
      setDetailLoadingByShopId((current) => ({ ...current, [shopId]: false }));
    }
  }

  useEffect(() => {
    if (!selectedShopId) return;
    if (detailByShopId[selectedShopId] || detailLoadingByShopId[selectedShopId]) return;
    void loadShopDetail(selectedShopId);
  }, [selectedShopId, detailByShopId, detailLoadingByShopId]);

  async function handleRefresh() {
    setMessage(null);
    await Promise.all([
      loadDashboard(),
      loadShops(),
      selectedShopId ? loadShopDetail(selectedShopId) : Promise.resolve(),
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      if (editingShopId) {
        await updateCentralShop(editingShopId, form);
        setMessage("Shop updated.");
      } else {
        await createCentralShop(form);
        setMessage("Shop added.");
      }
      setForm(EMPTY_FORM);
      setEditingShopId(null);
      await Promise.all([loadDashboard(), loadShops()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save shop");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(shop: CentralShopEndpoint) {
    setEditingShopId(shop.id);
    setForm({
      shopName: shop.shopName,
      baseUrl: shop.baseUrl,
      active: shop.active,
    });
    setMessage(null);
  }

  async function handleDelete(shop: CentralShopEndpoint) {
    if (!window.confirm(`Delete ${shop.shopName}?`)) return;
    setMessage(null);
    setError(null);
    try {
      await deleteCentralShop(shop.id);
      if (editingShopId === shop.id) {
        setEditingShopId(null);
        setForm(EMPTY_FORM);
      }
      setMessage("Shop deleted.");
      await Promise.all([loadDashboard(), loadShops()]);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete shop");
    }
  }

  function resetWorkerForm() {
    setEditingWorkerId(null);
    setWorkerForm(createEmptyWorkerForm());
  }

  function handleEditWorker(worker: Worker) {
    setEditingWorkerId(worker.id);
    setWorkerForm(normalizeWorkerForForm(worker));
  }

  async function handleSaveWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateWorkerForm(workerForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setWorkerSaving(true);
    setError(null);
    setMessage(null);
    const payload = buildWorkerPayload(workerForm);
    try {
      if (editingWorkerId) {
        await updateCentralWorker(editingWorkerId, payload);
        setMessage("Central operator updated.");
      } else {
        await createCentralWorker(payload);
        setMessage("Central operator created.");
      }
      resetWorkerForm();
      await loadShops();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save central operator");
    } finally {
      setWorkerSaving(false);
    }
  }

  async function handleDeleteWorker(worker: Worker) {
    if (!window.confirm(`Delete operator ${worker.name}?`)) return;
    setError(null);
    setMessage(null);
    try {
      await deleteCentralWorker(worker.id);
      if (editingWorkerId === worker.id) {
        resetWorkerForm();
      }
      setMessage("Central operator deleted.");
      await loadShops();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete central operator");
    }
  }

  async function handleAddDesignation() {
    const name = newDesignationName.trim();
    if (!name) {
      setError("Designation name is required");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await createCentralDesignation({ name, active: true });
      setNewDesignationName("");
      setWorkerForm((current) => ({ ...current, designationName: name }));
      await loadShops();
      setMessage("Designation added.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to add designation");
    }
  }

  async function handleAddWorkLocation() {
    const name = newWorkLocationName.trim();
    if (!name) {
      setError("Work location name is required");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await createCentralWorkLocation({ name, active: true });
      setNewWorkLocationName("");
      setWorkerForm((current) => ({ ...current, workLocationName: name }));
      await loadShops();
      setMessage("Work location added.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to add work location");
    }
  }

  async function handleWorkerAssetSelect(
    event: ChangeEvent<HTMLInputElement>,
    target: "profileImage" | "resumeFile" | "aadhaarImage"
  ) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      setWorkerForm((current) => ({ ...current, [target]: asset }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to read file");
    } finally {
      input.value = "";
    }
  }

  async function handleWorkerDocumentFileSelect(event: ChangeEvent<HTMLInputElement>, id: string) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      const apply = (rows: DocumentFormRow[]) =>
        rows.map((row) =>
          row.id === id
            ? {
                ...row,
                fileName: asset.fileName,
                mimeType: asset.mimeType,
                fileDataBase64: asset.base64,
              }
            : row
        );
      setWorkerForm((current) => ({
        ...current,
        otherProofs: apply(current.otherProofs),
        additionalDetails: apply(current.additionalDetails),
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to read file");
    } finally {
      input.value = "";
    }
  }

  async function handleSaveReverseSyncSettings() {
    setReverseSyncSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = await updateCentralReverseSyncSettings(reverseSyncSettings);
      setReverseSyncSettings(data);
      setSavedReverseSyncSettings(data);
      setMessage("Central reverse sync settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save central reverse sync settings"
      );
    } finally {
      setReverseSyncSaving(false);
    }
  }

  const existingBestSellingCodeSet = new Set(
    bestSellingRows.map((row) => normalizeText(row.itemCode)).filter(Boolean)
  );
  const filteredAddProducts = masterProducts
    .filter((product) => !existingBestSellingCodeSet.has(normalizeText(product.itemCode)))
    .filter((product) => {
      if (!bestSellingQuery.trim()) return true;
      return buildProductSearchText(product).includes(normalizeText(bestSellingQuery));
    })
    .slice(0, 80);
  const filteredExistingBestSelling = bestSellingRows.filter((row) => {
    if (!bestSellingListQuery.trim()) return true;
    return buildProductSearchText(row).includes(normalizeText(bestSellingListQuery));
  });
  const filteredWorkers = workers.filter((worker) => {
    if (!workerListQuery.trim()) return true;
    return [worker.name, worker.phone, worker.designationName, worker.workLocationName, worker.fatherName]
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .join(" ")
      .includes(normalizeText(workerListQuery));
  });
  const isReverseSyncDirty =
    reverseSyncSettings.reverseSyncOperatorsEnabled !==
      savedReverseSyncSettings.reverseSyncOperatorsEnabled ||
    reverseSyncSettings.reverseSyncBestSellingEnabled !==
      savedReverseSyncSettings.reverseSyncBestSellingEnabled;

  async function handleAddBestSelling(product: MasterProduct) {
    setBestSellingSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createCentralBestSelling({
        itemCode: product.itemCode,
        itemName: product.itemName,
        brandName: product.brandName,
        packValue: product.packValue,
        active: true,
      });
      setMessage(`Added ${product.itemCode} to central best selling.`);
      await loadShops();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to add central best selling product"
      );
    } finally {
      setBestSellingSaving(false);
    }
  }

  async function handleDeleteBestSelling(row: BestSellingProduct) {
    if (!window.confirm(`Remove ${row.itemCode} from central best selling?`)) return;
    setBestSellingSaving(true);
    setError(null);
    setMessage(null);
    try {
      await deleteCentralBestSelling(row.id);
      setMessage(`Removed ${row.itemCode} from central best selling.`);
      await loadShops();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete central best selling product"
      );
    } finally {
      setBestSellingSaving(false);
    }
  }

  function openShopDetail(shop: CentralDashboardShop) {
    setRoute({ page: "dashboard", shopId: shop.id });
  }

  function toggleShopAccordion(shopId: number) {
    setOpenShopIds((current) => ({
      ...current,
      [shopId]: current[shopId] === false,
    }));
  }

  function handleSaveBackendUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backendUrlInput.trim()) {
      setError("Central backend URL is required");
      return;
    }

    const backend = setApiBaseUrl(backendUrlInput);
    setCurrentBackendUrl(backend);
    setBackendUrlInput(backend);
    setError(null);
    setMessage("Central backend URL saved.");
    void Promise.all([loadDashboard(), loadShops()]);
  }

  function handleResetBackendUrl() {
    const backend = resetApiBaseUrl();
    setCurrentBackendUrl(backend);
    setBackendUrlInput(backend);
    setError(null);
    setMessage("Central backend URL reset to default.");
    void Promise.all([loadDashboard(), loadShops()]);
  }

  const pageTitle =
    activePage === "dashboard"
      ? "Central summary dashboard"
      : activePage === "ports"
        ? "Port registry"
        : activePage === "operators"
          ? "Operator management"
          : "Best selling management";
  const pageDescription =
    activePage === "dashboard"
      ? "Monitor today and cycle summary shop by shop."
      : activePage === "ports"
        ? "Add shop URLs and manage active shop connections."
        : activePage === "operators"
          ? "Create, edit, and remove operators from the central list."
          : "Add products from the master list and manage current best selling items.";
  const selectedShop = dashboard?.shops.find((shop) => shop.id === selectedShopId) || null;
  const selectedShopDetail = selectedShopId ? detailByShopId[selectedShopId] || null : null;
  const selectedShopDetailLoading = selectedShopId ? detailLoadingByShopId[selectedShopId] === true : false;

  return (
    <main className="app-shell">
      <header className="top-navbar">
        <div className="top-navbar-content">
          <div className="top-navbar-brand">
            <h1>Central Dashboard</h1>
          </div>
          <div className="top-navbar-actions">
            <button
              className="primary-button"
              onClick={() => void handleRefresh()}
              disabled={loading || settingsLoading}
            >
              Refresh dashboard
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-label={settingsOpen ? "Close settings" : "Open settings"}
              title={settingsOpen ? "Close settings" : "Open settings"}
            >
              <SettingsIcon />
            </button>
          </div>
        </div>
      </header>

      {settingsOpen ? (
        <button
          className="settings-backdrop"
          type="button"
          aria-label="Close settings"
          onClick={() => setSettingsOpen(false)}
        />
      ) : null}

      <div className="page-content">
        {error ? <div className="banner banner-error">{error}</div> : null}
        {message ? <div className="banner banner-success">{message}</div> : null}

        {!selectedShopId ? (
          <section className="page-nav">
            <button
              className={`page-nav-button ${activePage === "dashboard" ? "is-active" : ""}`}
              type="button"
              onClick={() => setRoute({ page: "dashboard", shopId: null })}
            >
              Dashboard
            </button>
            <button
              className={`page-nav-button ${activePage === "ports" ? "is-active" : ""}`}
              type="button"
              onClick={() => setRoute({ page: "ports", shopId: null })}
            >
              Ports
            </button>
            <button
              className={`page-nav-button ${activePage === "operators" ? "is-active" : ""}`}
              type="button"
              onClick={() => setRoute({ page: "operators", shopId: null })}
            >
              Operators
            </button>
            <button
              className={`page-nav-button ${activePage === "best-selling" ? "is-active" : ""}`}
              type="button"
              onClick={() => setRoute({ page: "best-selling", shopId: null })}
            >
              Best Selling
            </button>
          </section>
        ) : null}

        {selectedShopId ? (
          <ShopDetailPage
            shop={selectedShop}
            detail={selectedShopDetail}
            loading={selectedShopDetailLoading}
            onBack={() => setRoute({ page: "dashboard", shopId: null })}
          />
        ) : null}

        {activePage === "dashboard" && !selectedShopId ? (
          <>
            <section className="dashboard-summary-stack">
              <div className="dashboard-summary-row dashboard-summary-row-meta">
                <SummaryStat label="Configured Shops" value={dashboard?.summary.shopCount ?? 0} />
                <SummaryStat label="Online" value={dashboard?.summary.onlineShopCount ?? 0} tone="success" />
                <SummaryStat label="Offline" value={dashboard?.summary.offlineShopCount ?? 0} tone="warning" />
                <SummaryStat
                  label="Nil Stock"
                  value={dashboard?.summary.nilStockCount ?? 0}
                  tone={(dashboard?.summary.nilStockCount ?? 0) > 0 ? "warning" : "success"}
                />
              </div>

              <article className="dashboard-summary-card">
                <header>
                  <p className="section-kicker">Today</p>
                  <h3>Today Summary</h3>
                </header>
                <div className="dashboard-summary-row">
                  <SummaryStat label="Matched" value={dashboard?.summary.today.matchedCount ?? 0} tone="success" />
                  <SummaryStat label="Mismatch" value={dashboard?.summary.today.mismatchCount ?? 0} tone="danger" />
                  <SummaryStat
                    label="Bottle Diff"
                    value={formatSignedBottles(dashboard?.summary.today.totalDiffBottles ?? 0)}
                  />
                  <SummaryStat
                    label="Cash Diff"
                    value={formatSignedCurrency(dashboard?.summary.today.totalDiffValue ?? 0)}
                    tone={(dashboard?.summary.today.totalDiffValue ?? 0) < 0 ? "danger" : "default"}
                  />
                </div>
              </article>

              <article className="dashboard-summary-card">
                <header>
                  <p className="section-kicker">Cycle</p>
                  <h3>Cycle Summary</h3>
                </header>
                <div className="dashboard-summary-row">
                  <SummaryStat label="Matched" value={dashboard?.summary.cycle.matchedCount ?? 0} tone="success" />
                  <SummaryStat label="Mismatch" value={dashboard?.summary.cycle.mismatchCount ?? 0} tone="danger" />
                  <SummaryStat
                    label="Bottle Diff"
                    value={formatSignedBottles(dashboard?.summary.cycle.totalDiffBottles ?? 0)}
                  />
                  <SummaryStat
                    label="Cash Diff"
                    value={formatSignedCurrency(dashboard?.summary.cycle.totalDiffValue ?? 0)}
                    tone={(dashboard?.summary.cycle.totalDiffValue ?? 0) < 0 ? "danger" : "default"}
                  />
                </div>
              </article>
            </section>

            <section className="dashboard-grid dashboard-grid-single">
              <div className="overview-column">
                <section className="section-card">
                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">Overview</p>
                      <h2>Remote shop summaries</h2>
                    </div>
                  </div>

                  {loading ? <p className="detail-empty">Loading dashboard...</p> : null}

                  {!loading && !dashboard?.shops.length ? (
                    <div className="empty-state">
                      <h3>No shops configured</h3>
                      <p>Add shop URLs in the Ports page to start aggregating stock data.</p>
                    </div>
                  ) : null}

                  <div className="shop-card-stack">
                    {dashboard?.shops.map((shop) => {
                      const isOnline = shop.status === "online";
                      const isOpen = openShopIds[shop.id] !== false;
                      const theme = getShopTheme(shop);
                      const showRegistryName =
                        normalizeText(shop.registryName) &&
                        normalizeText(shop.registryName) !== normalizeText(shop.shopName);

                      return (
                        <article
                          key={shop.id}
                          className={`shop-card ${isOnline ? "shop-card-online" : "shop-card-offline"} ${isOpen ? "shop-card-open" : "shop-card-collapsed"}`}
                          style={
                            {
                              "--shop-accent": theme.accent,
                              "--shop-accent-soft": theme.soft,
                              "--shop-accent-border": theme.border,
                            } as CSSProperties
                          }
                        >
                          <header className="shop-card-header">
                            <div>
                              <div className="shop-title-row">
                                <h3>{shop.shopName}</h3>
                                <span className={`status-pill status-${shop.status}`}>{shop.status}</span>
                              </div>
                              {showRegistryName ? <p className="shop-card-subtitle">{shop.registryName}</p> : null}
                              <a className="shop-card-link" href={shop.baseUrl} target="_blank" rel="noreferrer">
                                {shop.baseUrl}
                              </a>
                              {shop.cycle ? (
                                <p className="shop-card-cycle">
                                  {shop.cycle.currentCycle ? "Current" : "Latest"} cycle {shop.cycle.sno ?? "-"} ·{" "}
                                  {shop.cycle.cycleDate}
                                </p>
                              ) : null}
                            </div>
                            <div className="shop-card-actions">
                              {isOnline ? (
                                <button className="ghost-button" onClick={() => openShopDetail(shop)}>
                                  Open details
                                </button>
                              ) : null}
                              <button className="ghost-button" type="button" onClick={() => toggleShopAccordion(shop.id)}>
                                {isOpen ? "Shrink" : "Expand"}
                              </button>
                            </div>
                          </header>

                          {isOpen ? (
                            <>
                              {shop.error ? <div className="shop-error">{shop.error}</div> : null}

                              {!isOnline ? (
                                <div className="shop-offline-note">
                                  Central could not fetch `/api/stock/overview` from this shop URL.
                                </div>
                              ) : (
                                <>
                                  <section className="shop-nil-stock-card">
                                    <div className="shop-nil-stock-head">
                                      <h4>Nil Stock</h4>
                                      <span
                                        className={`status-pill ${(shop.nilStock?.totalCount ?? 0) > 0 ? "status-offline" : "status-online"}`}
                                      >
                                        {(shop.nilStock?.totalCount ?? 0) > 0 ? shop.nilStock.totalCount : "✓"}
                                      </span>
                                    </div>
                                    {(shop.nilStock?.totalCount ?? 0) > 0 ? (
                                      <p className="shop-nil-stock-list">
                                        {(shop.nilStock?.byLocation || [])
                                          .filter((row) => Number(row.count) > 0)
                                          .map((row) => `${row.label}: ${row.count}`)
                                          .join(" | ") || `${shop.nilStock.totalCount} products`}
                                      </p>
                                    ) : (
                                      <p className="shop-nil-stock-list">Nil stock ✓</p>
                                    )}
                                  </section>

                                  <div className="shop-summary-grid">
                                    <SummaryPanel
                                      title="Today"
                                      subtitle={
                                        shop.today?.activityDate ? `Activity date ${shop.today.activityDate}` : "Today summary"
                                      }
                                      metrics={shop.today?.summary}
                                    />
                                    <SummaryPanel
                                      title="Full Cycle"
                                      subtitle="Complete cycle summary"
                                      metrics={shop.cycleSummary}
                                    />
                                  </div>

                                  <div className="location-summary-grid">
                                    {shop.locations.map((location) => (
                                      <article key={`${shop.id}-${location.shopLocationId}`} className="location-summary-card">
                                        <div className="location-summary-head">
                                          <h4>{location.shopLocationLabel}</h4>
                                          <p>{location.shopLocationName}</p>
                                        </div>
                                        <div className="location-summary-columns">
                                          <div>
                                            <span className="mini-label">Today</span>
                                            <ul>
                                              <li>Matched {location.today?.matchedCount ?? 0}</li>
                                              <li>Mismatch {location.today?.mismatchCount ?? 0}</li>
                                              <li>Bottle Diff {formatSignedBottles(location.today?.totalDiffBottles ?? 0)}</li>
                                              <li>Cash Diff {formatSignedCurrency(location.today?.totalDiffValue ?? 0)}</li>
                                            </ul>
                                          </div>
                                          <div>
                                            <span className="mini-label">Cycle</span>
                                            <ul>
                                              <li>Matched {location.cycle?.matchedCount ?? 0}</li>
                                              <li>Mismatch {location.cycle?.mismatchCount ?? 0}</li>
                                              <li>Bottle Diff {formatSignedBottles(location.cycle?.totalDiffBottles ?? 0)}</li>
                                              <li>Cash Diff {formatSignedCurrency(location.cycle?.totalDiffValue ?? 0)}</li>
                                            </ul>
                                          </div>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                </>
                              )}
                            </>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
            </section>
          </>
        ) : null}

        {activePage === "ports" ? (
          <section className="section-card simple-page">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Ports</p>
                <h2>{pageTitle}</h2>
                <p className="settings-note">{pageDescription}</p>
              </div>
            </div>

            <div className="split-page-grid">
              <div className="simple-list split-page-list">
                <div className="settings-list-header">
                  <h3>Saved shops</h3>
                  <span>{shops.length} total</span>
                </div>
                {settingsLoading ? <p className="detail-empty">Loading shop registry...</p> : null}
                {!settingsLoading && !shops.length ? <p className="detail-empty">No saved shop URLs yet.</p> : null}
                {shops.map((shop) => (
                  <article key={shop.id} className="settings-list-item">
                    <div>
                      <div className="shop-title-row">
                        <strong>{shop.shopName}</strong>
                        <span className={`status-pill status-${shop.active ? "online" : "offline"}`}>
                          {shop.active ? "active" : "inactive"}
                        </span>
                      </div>
                      <p>{shop.baseUrl}</p>
                    </div>
                    <div className="settings-row-actions">
                      <button className="ghost-button" type="button" onClick={() => handleEdit(shop)}>
                        Edit
                      </button>
                      <button className="danger-button" type="button" onClick={() => void handleDelete(shop)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <form className="settings-form simple-form split-page-form" onSubmit={handleSubmit}>
                <div className="settings-list-header">
                  <h3>{editingShopId ? "Update shop" : "Create shop"}</h3>
                </div>

                <label>
                  <span>Shop name</span>
                  <input
                    value={form.shopName}
                    onChange={(event) => setForm((current) => ({ ...current, shopName: event.target.value }))}
                    placeholder="Enter shop name"
                    required
                  />
                </label>

                <label>
                  <span>Backend URL / Port</span>
                  <input
                    value={form.baseUrl}
                    onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder="http://192.168.1.10:4000"
                    required
                  />
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                  <span>Active shop</span>
                </label>

                <div className="form-actions">
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Saving..." : editingShopId ? "Update shop" : "Add shop"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setEditingShopId(null);
                      setForm(EMPTY_FORM);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {activePage === "operators" ? (
          <section className="section-card simple-page">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Operators</p>
                <h2>{pageTitle}</h2>
                <p className="settings-note">{pageDescription}</p>
              </div>
            </div>

            <div className="split-page-grid">
              <div className="simple-list split-page-list">
                <div className="settings-list-header">
                  <h3>Operator list</h3>
                  <span>{workers.length} total</span>
                </div>
                <div className="settings-form simple-form list-filter-block">
                  <label>
                    <span>Search operators</span>
                    <input
                      value={workerListQuery}
                      onChange={(event) => setWorkerListQuery(event.target.value)}
                      placeholder="Search by name, phone, designation"
                    />
                  </label>
                </div>
                {filteredWorkers.map((worker) => (
                  <article key={worker.id} className="settings-list-item">
                    <div>
                      <div className="operator-list-row">
                        {worker.profileImageBase64 ? (
                          <img
                            className="operator-list-photo"
                            src={`data:${worker.profileImageMimeType || "image/jpeg"};base64,${worker.profileImageBase64}`}
                            alt={worker.name}
                          />
                        ) : (
                          <div className="operator-list-photo operator-list-photo-fallback">
                            {String(worker.name || "?").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="shop-title-row">
                            <strong>{worker.name}</strong>
                            <span className={`status-pill status-${worker.active ? "online" : "offline"}`}>
                              {worker.active ? "active" : "inactive"}
                            </span>
                          </div>
                          <p>{worker.designationName || "-"}</p>
                          <p>{worker.workLocationName || "No work location"}</p>
                          <p>
                            {worker.phoneNumbers?.find((row) => row.isPrimary)?.phoneNumber || worker.phone || "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="settings-row-actions">
                      <button className="ghost-button" type="button" onClick={() => setViewingWorker(worker)}>
                        View
                      </button>
                      <button className="ghost-button" type="button" onClick={() => handleEditWorker(worker)}>
                        Edit
                      </button>
                      <button className="danger-button" type="button" onClick={() => void handleDeleteWorker(worker)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
                {!filteredWorkers.length ? <p className="detail-empty">No operators found.</p> : null}
              </div>

              <form className="settings-form simple-form split-page-form" onSubmit={handleSaveWorker}>
                <div className="settings-list-header">
                  <h3>{editingWorkerId ? "Update operator" : "Create operator"}</h3>
                </div>

                <div className="operator-form-section">
                  <h4>Profile</h4>
                  <label>
                    <span>Name</span>
                    <input
                      value={workerForm.name}
                      onChange={(event) => setWorkerForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Enter operator name"
                      required
                    />
                  </label>
                  <label>
                    <span>Father's Name</span>
                    <input
                      value={workerForm.fatherName}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, fatherName: event.target.value }))
                      }
                      placeholder="Enter father's name"
                      required
                    />
                  </label>
                  <label>
                    <span>Designation</span>
                    <select
                      value={workerForm.designationName}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, designationName: event.target.value }))
                      }
                      required
                    >
                      <option value="">Select designation</option>
                      {designations
                        .filter((row) => row.active)
                        .map((row) => (
                          <option key={row.id} value={row.name}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-actions">
                    <input
                      value={newDesignationName}
                      onChange={(event) => setNewDesignationName(event.target.value)}
                      placeholder="Add new designation"
                    />
                    <button className="ghost-button" type="button" onClick={() => void handleAddDesignation()}>
                      Add
                    </button>
                  </div>
                  <label>
                    <span>Work Location</span>
                    <select
                      value={workerForm.workLocationName}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, workLocationName: event.target.value }))
                      }
                    >
                      <option value="">None</option>
                      {workLocations
                        .filter((row) => row.active)
                        .map((row) => (
                          <option key={row.id} value={row.name}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-actions">
                    <input
                      value={newWorkLocationName}
                      onChange={(event) => setNewWorkLocationName(event.target.value)}
                      placeholder="Add new work location"
                    />
                    <button className="ghost-button" type="button" onClick={() => void handleAddWorkLocation()}>
                      Add
                    </button>
                  </div>
                  <label>
                    <span>Recommended By</span>
                    <input
                      value={workerForm.recommendedBy}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, recommendedBy: event.target.value }))
                      }
                    />
                  </label>
                  <div className="operator-upload-card">
                    <span>Profile Image</span>
                    {workerForm.profileImage ? (
                      <img
                        className="operator-image-preview"
                        src={assetToDataUrl(workerForm.profileImage)}
                        alt="Profile preview"
                      />
                    ) : (
                      <p className="detail-empty">No profile image selected.</p>
                    )}
                    <div className="form-actions">
                      <label className="ghost-button operator-upload-button">
                        Use Camera
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          hidden
                          onChange={(event) => void handleWorkerAssetSelect(event, "profileImage")}
                        />
                      </label>
                      <label className="ghost-button operator-upload-button">
                        Upload from Gallery
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => void handleWorkerAssetSelect(event, "profileImage")}
                        />
                      </label>
                    </div>
                    {workerForm.profileImage?.fileName ? <p>{workerForm.profileImage.fileName}</p> : null}
                  </div>
                </div>

                <div className="operator-form-section">
                  <h4>Employment & Contact</h4>
                  <label>
                    <span>Date of Birth</span>
                    <input
                      type="date"
                      value={workerForm.dateOfBirth}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, dateOfBirth: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Date of Joining</span>
                    <input
                      type="date"
                      value={workerForm.dateOfJoining}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, dateOfJoining: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Date of Resignation</span>
                    <input
                      type="date"
                      value={workerForm.dateOfResignation}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, dateOfResignation: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Email ID</span>
                    <input
                      value={workerForm.email}
                      onChange={(event) => setWorkerForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    <span>Permanent Address</span>
                    <textarea
                      value={workerForm.permanentAddress}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, permanentAddress: event.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                  <label>
                    <span>Temporary Address</span>
                    <textarea
                      value={workerForm.temporaryAddress}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, temporaryAddress: event.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                  <div className="operator-repeatable-block">
                    <div className="settings-list-header">
                      <h4>Phone Numbers</h4>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() =>
                          setWorkerForm((current) => ({
                            ...current,
                            phoneNumbers: [...current.phoneNumbers, createPhoneRow()],
                          }))
                        }
                      >
                        Add Phone
                      </button>
                    </div>
                    {workerForm.phoneNumbers.map((row) => (
                      <div key={row.id} className="operator-repeatable-item">
                        <label>
                          <span>Label</span>
                          <input
                            value={row.label}
                            onChange={(event) =>
                              setWorkerForm((current) => ({
                                ...current,
                                phoneNumbers: current.phoneNumbers.map((phoneRow) =>
                                  phoneRow.id === row.id ? { ...phoneRow, label: event.target.value } : phoneRow
                                ),
                              }))
                            }
                            placeholder="Primary / Secondary"
                          />
                        </label>
                        <label>
                          <span>Phone Number</span>
                          <input
                            value={row.phoneNumber}
                            onChange={(event) =>
                              setWorkerForm((current) => ({
                                ...current,
                                phoneNumbers: current.phoneNumbers.map((phoneRow) =>
                                  phoneRow.id === row.id ? { ...phoneRow, phoneNumber: event.target.value } : phoneRow
                                ),
                              }))
                            }
                          />
                        </label>
                        <div className="form-actions">
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() =>
                              setWorkerForm((current) => ({
                                ...current,
                                phoneNumbers: current.phoneNumbers.map((phoneRow) => ({
                                  ...phoneRow,
                                  isPrimary: phoneRow.id === row.id,
                                })),
                              }))
                            }
                          >
                            {row.isPrimary ? "Primary" : "Set Primary"}
                          </button>
                          {workerForm.phoneNumbers.length > 1 ? (
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() =>
                                setWorkerForm((current) => {
                                  const nextRows = current.phoneNumbers.filter((phoneRow) => phoneRow.id !== row.id);
                                  return {
                                    ...current,
                                    phoneNumbers: nextRows.map((phoneRow, index) => ({
                                      ...phoneRow,
                                      isPrimary: index === 0 ? true : phoneRow.isPrimary,
                                    })),
                                  };
                                })
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="operator-form-section">
                  <h4>Identity & Bank</h4>
                  <label>
                    <span>Aadhaar Number</span>
                    <input
                      value={workerForm.aadhaarNumber}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, aadhaarNumber: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Bank Account Number</span>
                    <input
                      value={workerForm.bankAccountNumber}
                      onChange={(event) =>
                        setWorkerForm((current) => ({ ...current, bankAccountNumber: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>IFSC Code</span>
                    <input
                      value={workerForm.ifscCode}
                      onChange={(event) => setWorkerForm((current) => ({ ...current, ifscCode: event.target.value }))}
                    />
                  </label>
                  <div className="operator-upload-card">
                    <span>Resume File</span>
                    <div className="form-actions">
                      <label className="ghost-button operator-upload-button">
                        Upload Resume
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,image/*"
                          hidden
                          onChange={(event) => void handleWorkerAssetSelect(event, "resumeFile")}
                        />
                      </label>
                    </div>
                    {workerForm.resumeFile?.fileName ? (
                      <p>{workerForm.resumeFile.fileName}</p>
                    ) : (
                      <p className="detail-empty">No resume selected.</p>
                    )}
                  </div>
                  <div className="operator-upload-card">
                    <span>Aadhaar Image</span>
                    {workerForm.aadhaarImage ? (
                      <img
                        className="operator-image-preview"
                        src={assetToDataUrl(workerForm.aadhaarImage)}
                        alt="Aadhaar preview"
                      />
                    ) : (
                      <p className="detail-empty">No Aadhaar image selected.</p>
                    )}
                    <div className="form-actions">
                      <label className="ghost-button operator-upload-button">
                        Use Camera
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          hidden
                          onChange={(event) => void handleWorkerAssetSelect(event, "aadhaarImage")}
                        />
                      </label>
                      <label className="ghost-button operator-upload-button">
                        Upload from Gallery
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => void handleWorkerAssetSelect(event, "aadhaarImage")}
                        />
                      </label>
                    </div>
                    {workerForm.aadhaarImage?.fileName ? <p>{workerForm.aadhaarImage.fileName}</p> : null}
                  </div>
                </div>

                <div className="operator-form-section">
                  <div className="settings-list-header">
                    <h4>Other Proofs</h4>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        setWorkerForm((current) => ({
                          ...current,
                          otherProofs: [...current.otherProofs, createDocumentRow("otherProof")],
                        }))
                      }
                    >
                      Add Proof
                    </button>
                  </div>
                  {workerForm.otherProofs.map((row) => (
                    <div key={row.id} className="operator-repeatable-item">
                      <label>
                        <span>Label</span>
                        <input
                          value={row.label}
                          onChange={(event) =>
                            setWorkerForm((current) => ({
                              ...current,
                              otherProofs: current.otherProofs.map((proofRow) =>
                                proofRow.id === row.id ? { ...proofRow, label: event.target.value } : proofRow
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Text</span>
                        <textarea
                          value={row.textValue}
                          onChange={(event) =>
                            setWorkerForm((current) => ({
                              ...current,
                              otherProofs: current.otherProofs.map((proofRow) =>
                                proofRow.id === row.id ? { ...proofRow, textValue: event.target.value } : proofRow
                              ),
                            }))
                          }
                          rows={2}
                        />
                      </label>
                      <div className="form-actions">
                        <label className="ghost-button operator-upload-button">
                          Upload File
                          <input
                            type="file"
                            hidden
                            onChange={(event) => void handleWorkerDocumentFileSelect(event, row.id)}
                          />
                        </label>
                        {workerForm.otherProofs.length > 1 ? (
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              setWorkerForm((current) => ({
                                ...current,
                                otherProofs: current.otherProofs.filter((proofRow) => proofRow.id !== row.id),
                              }))
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      {row.fileName ? <p>{row.fileName}</p> : null}
                    </div>
                  ))}
                </div>

                <div className="operator-form-section">
                  <div className="settings-list-header">
                    <h4>Additional Details</h4>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        setWorkerForm((current) => ({
                          ...current,
                          additionalDetails: [...current.additionalDetails, createDocumentRow("additionalDetail")],
                        }))
                      }
                    >
                      Add Detail
                    </button>
                  </div>
                  {workerForm.additionalDetails.map((row) => (
                    <div key={row.id} className="operator-repeatable-item">
                      <label>
                        <span>Label</span>
                        <input
                          value={row.label}
                          onChange={(event) =>
                            setWorkerForm((current) => ({
                              ...current,
                              additionalDetails: current.additionalDetails.map((detailRow) =>
                                detailRow.id === row.id ? { ...detailRow, label: event.target.value } : detailRow
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Text</span>
                        <textarea
                          value={row.textValue}
                          onChange={(event) =>
                            setWorkerForm((current) => ({
                              ...current,
                              additionalDetails: current.additionalDetails.map((detailRow) =>
                                detailRow.id === row.id ? { ...detailRow, textValue: event.target.value } : detailRow
                              ),
                            }))
                          }
                          rows={2}
                        />
                      </label>
                      <div className="form-actions">
                        <label className="ghost-button operator-upload-button">
                          Upload File
                          <input
                            type="file"
                            hidden
                            onChange={(event) => void handleWorkerDocumentFileSelect(event, row.id)}
                          />
                        </label>
                        {workerForm.additionalDetails.length > 1 ? (
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              setWorkerForm((current) => ({
                                ...current,
                                additionalDetails: current.additionalDetails.filter((detailRow) => detailRow.id !== row.id),
                              }))
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      {row.fileName ? <p>{row.fileName}</p> : null}
                    </div>
                  ))}
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={workerForm.active}
                    onChange={(event) =>
                      setWorkerForm((current) => ({ ...current, active: event.target.checked }))
                    }
                  />
                  <span>Active operator</span>
                </label>

                <div className="form-actions">
                  <button className="primary-button" type="submit" disabled={workerSaving}>
                    {workerSaving ? "Saving..." : editingWorkerId ? "Update operator" : "Create operator"}
                  </button>
                  <button className="ghost-button" type="button" onClick={resetWorkerForm}>
                    Clear
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {activePage === "best-selling" ? (
          <section className="section-card simple-page">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Best Selling</p>
                <h2>{pageTitle}</h2>
                <p className="settings-note">{pageDescription}</p>
              </div>
            </div>

            <div className="split-page-grid">
              <div className="simple-list split-page-list">
                <div className="settings-list-header">
                  <h3>Current list</h3>
                  <span>{filteredExistingBestSelling.length} visible</span>
                </div>
                <div className="settings-form simple-form list-filter-block">
                  <label>
                    <span>Filter current best selling</span>
                    <input
                      value={bestSellingListQuery}
                      onChange={(event) => setBestSellingListQuery(event.target.value)}
                      placeholder="Search current list"
                    />
                  </label>
                </div>
                {filteredExistingBestSelling.map((row) => (
                  <article key={row.id} className="settings-list-item">
                    <div>
                      <strong>{row.brandName || row.itemName || row.itemCode}</strong>
                      <p>
                        {row.itemName || "-"} • {row.packValue || "-"} • {row.itemCode}
                      </p>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className="danger-button"
                        type="button"
                        disabled={bestSellingSaving}
                        onClick={() => void handleDeleteBestSelling(row)}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
                {!filteredExistingBestSelling.length ? (
                  <p className="detail-empty">No products in central best selling.</p>
                ) : null}
              </div>

              <div className="settings-form simple-form split-page-form">
                <div className="settings-list-header">
                  <h3>Add products</h3>
                  <span>{filteredAddProducts.length} visible</span>
                </div>
                <label>
                  <span>Search master products to add</span>
                  <input
                    value={bestSellingQuery}
                    onChange={(event) => setBestSellingQuery(event.target.value)}
                    placeholder="Search by item code, brand, item or barcode"
                  />
                </label>
                {filteredAddProducts.map((product) => (
                  <article key={product.itemCode} className="settings-list-item">
                    <div>
                      <strong>{product.brandName || product.itemName || product.itemCode}</strong>
                      <p>
                        {product.itemName || "-"} • {product.packValue || "-"} • {product.itemCode}
                      </p>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={bestSellingSaving}
                        onClick={() => void handleAddBestSelling(product)}
                      >
                        Add
                      </button>
                    </div>
                  </article>
                ))}
                {!filteredAddProducts.length ? <p className="detail-empty">No products available to add.</p> : null}
              </div>
            </div>
          </section>
        ) : null}

        {viewingWorker ? (
          <>
            <button
              className="profile-modal-backdrop"
              type="button"
              aria-label="Close operator details"
              onClick={() => setViewingWorker(null)}
            />
            <section className="profile-modal">
              <div className="profile-modal-card">
                <div className="settings-list-header">
                  <div className="operator-list-row">
                    {viewingWorker.profileImageBase64 ? (
                      <img
                        className="operator-image-preview"
                        src={fileDataToUrl(viewingWorker.profileImageBase64, viewingWorker.profileImageMimeType)}
                        alt={viewingWorker.name}
                      />
                    ) : (
                      <div className="operator-list-photo operator-list-photo-fallback">
                        {String(viewingWorker.name || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3>{viewingWorker.name}</h3>
                      <p>{viewingWorker.designationName || "-"}</p>
                      <p>{viewingWorker.workLocationName || "No work location"}</p>
                    </div>
                  </div>
                  <button className="ghost-button" type="button" onClick={() => setViewingWorker(null)}>
                    Close
                  </button>
                </div>

                <div className="profile-modal-grid">
                  <section className="operator-upload-card">
                    <h4>Basic Info</h4>
                    <p><strong>Father's Name:</strong> {viewingWorker.fatherName || "-"}</p>
                    <p><strong>Recommended By:</strong> {viewingWorker.recommendedBy || "-"}</p>
                    <p><strong>DOB:</strong> {toDateInputValue(viewingWorker.dateOfBirth) || "-"}</p>
                    <p><strong>Joining:</strong> {toDateInputValue(viewingWorker.dateOfJoining) || "-"}</p>
                    <p><strong>Resignation:</strong> {toDateInputValue(viewingWorker.dateOfResignation) || "-"}</p>
                    <p><strong>Email:</strong> {viewingWorker.email || "-"}</p>
                    <p><strong>Status:</strong> {viewingWorker.active ? "Active" : "Inactive"}</p>
                  </section>

                  <section className="operator-upload-card">
                    <h4>Addresses</h4>
                    <p><strong>Permanent:</strong> {viewingWorker.permanentAddress || "-"}</p>
                    <p><strong>Temporary:</strong> {viewingWorker.temporaryAddress || "-"}</p>
                  </section>

                  <section className="operator-upload-card">
                    <h4>Phone Numbers</h4>
                    {(viewingWorker.phoneNumbers || []).length ? (
                      (viewingWorker.phoneNumbers || []).map((row, index) => (
                        <p key={`${row.phoneNumber}-${index}`}>
                          <strong>{row.label || (row.isPrimary ? "Primary" : `Phone ${index + 1}`)}:</strong> {row.phoneNumber}
                        </p>
                      ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h4>Identity & Bank</h4>
                    <p><strong>Aadhaar:</strong> {viewingWorker.aadhaarNumber || "-"}</p>
                    <p><strong>Bank Account:</strong> {viewingWorker.bankAccountNumber || "-"}</p>
                    <p><strong>IFSC:</strong> {viewingWorker.ifscCode || "-"}</p>
                    {viewingWorker.aadhaarImageBase64 ? (
                      <img
                        className="operator-image-preview"
                        src={fileDataToUrl(viewingWorker.aadhaarImageBase64, viewingWorker.aadhaarImageMimeType)}
                        alt="Aadhaar"
                      />
                    ) : null}
                  </section>

                  <section className="operator-upload-card">
                    <h4>Resume</h4>
                    {viewingWorker.resumeFileBase64 ? (
                      <a
                        href={fileDataToUrl(viewingWorker.resumeFileBase64, viewingWorker.resumeFileMimeType)}
                        download={viewingWorker.resumeFileName || "resume"}
                      >
                        {viewingWorker.resumeFileName || "Download resume"}
                      </a>
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h4>Other Proofs</h4>
                    {(viewingWorker.documents || []).filter((row) => row.category === "otherProof").length ? (
                      (viewingWorker.documents || [])
                        .filter((row) => row.category === "otherProof")
                        .map((row, index) => (
                          <div key={`proof-${index}`} className="operator-document-row">
                            <p><strong>{row.label || "Proof"}:</strong> {row.textValue || "-"}</p>
                            {row.fileDataBase64 ? (
                              <a href={fileDataToUrl(row.fileDataBase64, row.mimeType)} download={row.fileName || "proof-file"}>
                                {row.fileName || "Download file"}
                              </a>
                            ) : null}
                          </div>
                        ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h4>Additional Details</h4>
                    {(viewingWorker.documents || []).filter((row) => row.category === "additionalDetail").length ? (
                      (viewingWorker.documents || [])
                        .filter((row) => row.category === "additionalDetail")
                        .map((row, index) => (
                          <div key={`detail-${index}`} className="operator-document-row">
                            <p><strong>{row.label || "Detail"}:</strong> {row.textValue || "-"}</p>
                            {row.fileDataBase64 ? (
                              <a href={fileDataToUrl(row.fileDataBase64, row.mimeType)} download={row.fileName || "detail-file"}>
                                {row.fileName || "Download file"}
                              </a>
                            ) : null}
                          </div>
                        ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>
                </div>
              </div>
            </section>
          </>
        ) : null}

        <aside className={`settings-column ${settingsOpen ? "settings-open" : ""}`}>
          <section className="section-card settings-card">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Connection</p>
                <h2>Central backend</h2>
                <p className="settings-note">
                  Default path uses the same StockLens pattern and is stored in local storage for this browser.
                </p>
              </div>
            </div>

            <form className="settings-form" onSubmit={handleSaveBackendUrl}>
              <label>
                <span>Central backend URL</span>
                <input
                  value={backendUrlInput}
                  onChange={(event) => setBackendUrlInput(event.target.value)}
                  placeholder={DEFAULT_API_BASE_URL}
                  required
                />
              </label>

              <div className="settings-meta-block">
                <span>Current</span>
                <strong>{currentBackendUrl || DEFAULT_API_BASE_URL}</strong>
              </div>

              <div className="form-actions">
                <button className="primary-button" type="submit">
                  Save backend
                </button>
                <button className="ghost-button" type="button" onClick={handleResetBackendUrl}>
                  Reset default
                </button>
                <button
                  className="ghost-button settings-close-button"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Close
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default App;
