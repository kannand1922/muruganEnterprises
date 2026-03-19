import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonFab,
  IonFabButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonPage,
  IonPopover,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  useIonAlert,
  useIonToast,
  useIonViewWillEnter,
} from "@ionic/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  addOutline,
  barcodeOutline,
  cameraOutline,
  chevronForwardOutline,
  closeOutline,
  cubeOutline,
  removeOutline,
  scanOutline,
  searchOutline,
  stopOutline,
  swapHorizontalOutline,
  textOutline,
  wineOutline,
} from "ionicons/icons";
import {
  BarcodeFormat,
  BarcodeScanner,
  type BarcodesScannedEvent,
} from "@capacitor-mlkit/barcode-scanning";
import { Capacitor } from "@capacitor/core";
import { Scanner as WebBarcodeScanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { prepareZXingModule, type BarcodeFormat as WebBarcodeFormat } from "barcode-detector";
import { useHistory } from "react-router-dom";
import readerWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { AppTopBar } from "../components/common/AppTopBar";
import { getCurrentCycle } from "../api/cyclesApi";
import {
  getAllMasterProducts,
  getBestSelling,
  getMasterStatus,
  getShopLocations,
  getWorkers,
  type BestSellingProduct,
  type MasterStatus,
  type MasterProduct,
  type ShopLocation,
  type Worker,
} from "../api/metaApi";
import {
  getFinishedProgressSummary,
  getFinishedStock,
  getUnfinishedStock,
  upsertUnfinishedStock,
  type FinishedStockRow,
  type FinishedProgressSummary,
  type UnfinishedStockRow,
} from "../api/stockApi";
import { CURRENT_LOCATION_ID_KEY, LOCATION_CHANGED_EVENT } from "../config/location";
import { getCurrentPhoneIdFromStorage } from "../config/phone";

type EntryMode = "scan" | "barcode" | "name";
const FAST_SELLING_FILTER = "fast_selling";
const SEARCH_ITEM_FILTER_KEY = "stocklens_search_item_filter";
const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_OPERATOR_NAME_KEY = "stocklens_current_operator_name";
const ALL_ITEMS_FILTER_VALUE = "__all__";
const SCAN_FORMATS = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Code93,
  BarcodeFormat.Codabar,
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.Itf,
] as const;
const SCAN_EVENT_DEBOUNCE_MS = 750;
const SCAN_RETRY_COOLDOWN_SECONDS = 1;
const DEFAULT_ANDROID_SCAN_ZOOM_RATIO = 1.5;
const WEB_SCAN_FORMATS: WebBarcodeFormat[] = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
];
let webScannerWasmConfigured = false;

function ensureWebScannerWasmConfigured() {
  if (webScannerWasmConfigured) return;
  webScannerWasmConfigured = true;

  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => {
        if (path.endsWith(".wasm")) {
          return readerWasmUrl;
        }
        return prefix + path;
      },
    },
  });
}

ensureWebScannerWasmConfigured();

function getWebCameraErrorMessage(error: unknown) {
  const domError =
    typeof DOMException !== "undefined" && error instanceof DOMException ? error : null;
  const errorName = domError?.name || (error instanceof Error ? error.name : "");

  if (!window.isSecureContext) {
    return "Camera on phone browser needs HTTPS or localhost. Open the site in a secure URL.";
  }

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return "Camera permission is blocked. In Chrome, open Site settings and allow Camera, then reload.";
  }

  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }

  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Camera is busy in another app or tab. Close other camera apps and try again.";
  }

  if (errorName === "OverconstrainedError" || errorName === "ConstraintNotSatisfiedError") {
    return "Back camera could not be started. Try again after reloading the page.";
  }

  return error instanceof Error && error.message
    ? error.message
    : "Unable to start camera on this browser.";
}

type SearchResult = MasterProduct & {
  matchScore: number;
  matchType: "exact" | "partial" | "abbreviation";
};

type GroupedSearchResult = {
  brandName: string;
  itemName: string;
  packSizes: SearchResult[];
  itemCodes: string[];
  matchScore: number;
};

function getFieldValue(value: string | number | null | undefined) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeCodeValue(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLocationKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitSearchTokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getBrandInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toLowerCase();
}

function matchesAllSearchTokens(value: string, tokens: string[]): boolean {
  if (!value || tokens.length < 2) return false;
  const normalized = value.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitSearchWords(value: string) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function isSubsequenceMatch(query: string, target: string) {
  const needle = normalizeSearchText(query);
  const haystack = normalizeSearchText(target);
  if (!needle || !haystack) return false;

  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index >= needle.length) return true;
    }
  }
  return false;
}

function matchesWordPrefixSignature(query: string, source: string) {
  const normalizedQuery = normalizeSearchText(query);
  const words = splitSearchWords(source);
  if (!normalizedQuery || words.length === 0) return false;

  for (let charsPerWord = 1; charsPerWord <= 3; charsPerWord += 1) {
    const signature = words
      .map((word) => word.slice(0, Math.min(charsPerWord, word.length)))
      .join("");
    if (signature.startsWith(normalizedQuery)) {
      return true;
    }
  }
  return false;
}

function matchesFlexibleSearch(brand: string, item: string, query: string) {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) return true;

  const combined = `${brand} ${item}`.trim();
  const tokens = splitSearchTokens(trimmed);
  const normalizedQuery = normalizeSearchText(trimmed);
  const normalizedBrand = normalizeSearchText(brand);
  const normalizedItem = normalizeSearchText(item);
  const normalizedCombined = normalizeSearchText(combined);

  if (tokens.length > 1) {
    if (
      matchesAllSearchTokens(brand, tokens) ||
      matchesAllSearchTokens(item, tokens) ||
      matchesAllSearchTokens(combined, tokens)
    ) {
      return true;
    }
  }

  if (brand.includes(trimmed) || item.includes(trimmed) || combined.includes(trimmed)) {
    return true;
  }

  if (
    normalizedQuery &&
    (normalizedBrand.includes(normalizedQuery) ||
      normalizedItem.includes(normalizedQuery) ||
      normalizedCombined.includes(normalizedQuery))
  ) {
    return true;
  }

  if (matchesWordPrefixSignature(trimmed, combined)) {
    return true;
  }

  return isSubsequenceMatch(trimmed, combined);
}

function getItemCodeParts(value: string) {
  const trimmed = value.trim();
  const [base = "", suffix = ""] = trimmed.split(".");
  return { base, suffix };
}

function toPackNumber(packValue: string | null | undefined) {
  const raw = getFieldValue(packValue).replace(/[^0-9.]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortPackSizesDesc<T extends { packValue?: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => toPackNumber(b.packValue) - toPackNumber(a.packValue));
}

function formatCurrency(value: number | string | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `₹${numeric.toFixed(2)}`;
}

function parseStockStringToBottles(stock: string | null | undefined, bpc: number) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [packsPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const packs = Math.max(0, Number.parseInt(packsPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const total = packs * bpc + bottles;
  return negative ? -total : total;
}

function bottlesToPackBottle(totalBottles: number, bpc: number) {
  const safeBpc = Math.max(1, bpc || 1);
  const packs = Math.floor(Math.max(0, totalBottles) / safeBpc);
  const bottles = Math.max(0, totalBottles) % safeBpc;
  return { packs, bottles };
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getActivityDateKey(isoDateTime: string) {
  return String(isoDateTime || "").slice(0, 10);
}

function getMasterStockBottles(product: MasterProduct, location: ShopLocation | null) {
  const safeBpc = Number(product.bpc) || 12;
  const locationCodeKey = normalizeLocationKey(location?.locationCode);
  const locationNameKey = normalizeLocationKey(location?.locationName);
  const locationTypeKey = normalizeLocationKey(location?.locationType || "");
  const locationStocks = product.locationStocks || {};
  const source =
    (locationCodeKey && locationStocks[locationCodeKey]) ||
    (locationNameKey && locationStocks[locationNameKey]) ||
    (locationTypeKey && locationStocks[locationTypeKey]) ||
    product.shopStock;
  return parseStockStringToBottles(source, safeBpc);
}

function buildSearchResults(
  query: string,
  mode: EntryMode,
  rows: MasterProduct[],
  isMatchedForLocation: (row: MasterProduct) => boolean
) {
  if (!query.trim() || mode === "scan") return [] as SearchResult[];
  const term = query.trim().toLowerCase();
  const searchTokens = splitSearchTokens(term);
  const hasMultipleTokens = searchTokens.length > 1;

  const scored: SearchResult[] = [];
  rows.forEach((row) => {
    const brand = getFieldValue(row.brandName).toLowerCase().trim();
    const itemName = getFieldValue(row.itemName).toLowerCase();
    const combinedName = `${brand} ${itemName}`.trim();
    const initials = combinedName ? getBrandInitials(combinedName) : "";
    const normalizedTerm = normalizeSearchText(term);
    const normalizedBrand = normalizeSearchText(brand);
    const normalizedItem = normalizeSearchText(itemName);
    const normalizedCombined = normalizeSearchText(combinedName);
    const brandTokensMatch = matchesAllSearchTokens(brand, searchTokens);
    const itemTokensMatch = matchesAllSearchTokens(itemName, searchTokens);
    const combinedTokensMatch = matchesAllSearchTokens(combinedName, searchTokens);

    let score = 0;
    let matchType: "exact" | "partial" | "abbreviation" = "partial";
    const rowMatchedForLocation = isMatchedForLocation(row);

    if (mode === "barcode") {
      const itemCode = getFieldValue(row.itemCode);
      if (!itemCode) return;
      const normalizedCode = normalizeCodeValue(itemCode.toLowerCase());
      const { base: rowBase, suffix: rowSuffix } = getItemCodeParts(normalizedCode);
      const { base: termBase, suffix: termSuffix } = getItemCodeParts(term);
      const hasPackSpecifier = term.includes(".");

      if (hasPackSpecifier) {
        if (normalizedCode === term) {
          score = 140;
          matchType = "exact";
        } else if (termSuffix && rowBase === termBase && rowSuffix.startsWith(termSuffix)) {
          score = 120 - Math.max(0, rowSuffix.length - termSuffix.length);
        } else if (normalizedCode.startsWith(term)) {
          score = 110;
        }
      } else {
        if (rowBase === term) {
          score = 130;
          matchType = "exact";
        } else if (normalizedCode.startsWith(`${term}.`)) {
          score = 115;
        } else if (rowBase.startsWith(term)) {
          score = 110 - Math.max(0, rowBase.length - term.length);
        } else if (normalizedCode.startsWith(term)) {
          score = 105;
        }
      }
    } else if (mode === "name") {
      if (brand === term || itemName === term) {
        score = 120;
        matchType = "exact";
      } else if (brand.startsWith(term)) {
        score = 110;
      } else if (itemName.startsWith(term)) {
        score = 100;
      } else if (initials && initials.startsWith(term)) {
        score = 95;
        matchType = "abbreviation";
      } else if (hasMultipleTokens && (brandTokensMatch || itemTokensMatch || combinedTokensMatch)) {
        score = brandTokensMatch ? 92 : combinedTokensMatch ? 90 : 88;
      } else if (brand.split(" ").some((word) => word.startsWith(term))) {
        score = 85;
      } else if (brand.startsWith(term)) {
        score = 80;
      } else if (itemName.startsWith(term)) {
        score = 75;
      } else if (
        normalizedTerm &&
        (normalizedBrand.includes(normalizedTerm) ||
          normalizedItem.includes(normalizedTerm) ||
          normalizedCombined.includes(normalizedTerm))
      ) {
        score = 72;
      } else if (matchesWordPrefixSignature(term, combinedName)) {
        score = 70;
        matchType = "abbreviation";
      } else if (isSubsequenceMatch(term, combinedName)) {
        score = 68;
        matchType = "abbreviation";
      }
    }

    if (score > 0 && !rowMatchedForLocation) {
      scored.push({ ...row, matchScore: score, matchType });
    }
  });

  return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, 40);
}

function groupSearchResults(results: SearchResult[]) {
  const groupMap = new Map<string, GroupedSearchResult>();
  for (const row of results) {
    const brandName = getFieldValue(row.brandName) || "Unknown";
    const itemName = getFieldValue(row.itemName) || "Unknown";
    const key = `${brandName.toLowerCase()}|${itemName.toLowerCase()}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        brandName,
        itemName,
        packSizes: [],
        itemCodes: [],
        matchScore: row.matchScore,
      });
    }
    const group = groupMap.get(key)!;
    group.packSizes.push(row);
    const code = getFieldValue(row.itemCode);
    if (code && !group.itemCodes.includes(code)) {
      group.itemCodes.push(code);
    }
    if (row.matchScore > group.matchScore) {
      group.matchScore = row.matchScore;
    }
  }
  return Array.from(groupMap.values()).sort((a, b) => b.matchScore - a.matchScore);
}

function mergeGroupedResults(groups: GroupedSearchResult[]) {
  const merged = new Map<string, GroupedSearchResult>();

  groups.forEach((group) => {
    const key = `${String(group.brandName || "").toLowerCase()}|${String(group.itemName || "").toLowerCase()}`;
    if (!merged.has(key)) {
      merged.set(key, {
        ...group,
        packSizes: [...group.packSizes],
        itemCodes: [...group.itemCodes],
      });
      return;
    }

    const existing = merged.get(key)!;
    group.packSizes.forEach((pack) => {
      if (!existing.packSizes.some((row) => getFieldValue(row.itemCode) === getFieldValue(pack.itemCode))) {
        existing.packSizes.push(pack);
      }
    });
    group.itemCodes.forEach((itemCode) => {
      if (!existing.itemCodes.includes(itemCode)) {
        existing.itemCodes.push(itemCode);
      }
    });
    if (group.matchScore > existing.matchScore) {
      existing.matchScore = group.matchScore;
    }
  });

  return Array.from(merged.values()).sort((a, b) => b.matchScore - a.matchScore);
}

export function StockEntryPage() {
  const [presentToast] = useIonToast();
  const [presentStockMismatchAlert] = useIonAlert();
  const history = useHistory();
  const [mode, setMode] = useState<EntryMode>("name");
  const [masterRows, setMasterRows] = useState<MasterProduct[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [activeCycleId, setActiveCycleId] = useState<number | null>(null);
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(null);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [operators, setOperators] = useState<Worker[]>([]);
  const [operatorSearchQuery, setOperatorSearchQuery] = useState("");
  const [showOperatorModal, setShowOperatorModal] = useState(false);
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);
  const [unfinishedRows, setUnfinishedRows] = useState<UnfinishedStockRow[]>([]);
  const [finishedRows, setFinishedRows] = useState<FinishedStockRow[]>([]);
  const [finishedProgress, setFinishedProgress] = useState<FinishedProgressSummary | null>(null);
  const [loadingFinishedProgress, setLoadingFinishedProgress] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [groupedSearchResults, setGroupedSearchResults] = useState<GroupedSearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchItemFilters, setSearchItemFilters] = useState<string[]>(() => {
    const rawStored = String(localStorage.getItem(SEARCH_ITEM_FILTER_KEY) || "").trim();
    if (!rawStored) return [];

    try {
      const parsed = JSON.parse(rawStored);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value || "").trim()).filter(Boolean);
      }
    } catch {
      // Keep backward compatibility with the previous single-select string storage.
    }

    if (rawStored.toLowerCase() === "all") return [];
    return [rawStored];
  });
  const [bestSellingRows, setBestSellingRows] = useState<BestSellingProduct[]>([]);
  const [isLoadingBestSelling, setIsLoadingBestSelling] = useState(false);
  const [masterStatus, setMasterStatus] = useState<MasterStatus | null>(null);
  const [masterStatusCheckFailed, setMasterStatusCheckFailed] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupedSearchResult | null>(null);
  const [showPackSizeModal, setShowPackSizeModal] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [canScan, setCanScan] = useState(true);
  const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);

  const [selectedProduct, setSelectedProduct] = useState<MasterProduct | null>(null);
  const [showStockModal, setShowStockModal] = useState(false);
  const [packQty, setPackQty] = useState("");
  const [bottleQty, setBottleQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [itemFilterPopoverOpen, setItemFilterPopoverOpen] = useState(false);
  const [itemFilterPopoverEvent, setItemFilterPopoverEvent] = useState<Event | undefined>(undefined);
  const [draftSearchItemFilters, setDraftSearchItemFilters] = useState<string[]>([]);

  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanTimeRef = useRef(0);
  const recheckPromptShownRef = useRef<Set<string>>(new Set());
  const dashboardRefreshInFlightRef = useRef(false);
  const pendingAutoPrefillRef = useRef(false);

  const currentLocation =
    locations.find((location) => location.id === currentLocationId) || null;
  const selectedOperator =
    operators.find((operator) => operator.id === selectedOperatorId) || null;

  const todayKey = getTodayDateString();
  const isCycleActive = Boolean(activeCycleId);
  const isMasterBlocked = masterStatusCheckFailed || Boolean(masterStatus && !masterStatus.allowed);

  const masterTotalProducts = useMemo(() => {
    const codeSet = new Set<string>();
    masterRows.forEach((row) => {
      const code = normalizeCodeValue(getFieldValue(row.itemCode));
      if (code) codeSet.add(code);
    });
    return codeSet.size;
  }, [masterRows]);

  const cycleScanSummary = useMemo(() => {
    const latestByCode = new Map<
      string,
      { row: FinishedStockRow; timeMs: number }
    >();

    finishedRows.forEach((row) => {
      const code = normalizeCodeValue(getFieldValue(row.itemCode));
      if (!code) return;
      const timeMs = new Date(
        row.updatedAt || row.finishedAt || row.activityDate || row.createdAt
      ).getTime();
      const existing = latestByCode.get(code);
      if (!existing || timeMs >= existing.timeMs) {
        latestByCode.set(code, { row, timeMs: Number.isFinite(timeMs) ? timeMs : 0 });
      }
    });

    const dedupRows = Array.from(latestByCode.values()).map((entry) => entry.row);
    const scannedCount = finishedProgress?.scannedCount ?? dedupRows.length;
    const totalProducts = Math.max(
      Number(finishedProgress?.totalProducts) || 0,
      masterTotalProducts
    );

    return {
      scannedCount,
      totalProducts,
    };
  }, [finishedRows, finishedProgress, masterTotalProducts]);

  const operatorScanSummary = useMemo(() => {
    const totalProducts = cycleScanSummary.totalProducts;
    if (!selectedOperatorId) {
      return {
        scannedCount: 0,
        matchedCount: 0,
        mismatchedCount: 0,
        operatorTotalProducts: 0,
        totalProducts,
      };
    }

    const latestByCode = new Map<
      string,
      { row: FinishedStockRow; timeMs: number }
    >();

    finishedRows.forEach((row) => {
      const rowOperatorId =
        Number(row.lastUpdatedByWorkerId || 0) || Number(row.finishedByWorkerId || 0) || null;
      if (rowOperatorId !== selectedOperatorId) return;

      const code = normalizeCodeValue(getFieldValue(row.itemCode));
      if (!code) return;

      const timeMs = new Date(
        row.updatedAt || row.finishedAt || row.activityDate || row.createdAt
      ).getTime();
      const existing = latestByCode.get(code);
      if (!existing || timeMs >= existing.timeMs) {
        latestByCode.set(code, { row, timeMs: Number.isFinite(timeMs) ? timeMs : 0 });
      }
    });

    const dedupRows = Array.from(latestByCode.values()).map((entry) => entry.row);
    const scannedCount = dedupRows.length;
    const matchedCount = dedupRows.filter(
      (row) => Boolean(row.isMatched) || Number(row.diffBottles || 0) === 0
    ).length;
    const mismatchedCount = Math.max(scannedCount - matchedCount, 0);
    const operatorTotalProducts = scannedCount;

    return {
      scannedCount,
      matchedCount,
      mismatchedCount,
      operatorTotalProducts,
      totalProducts,
    };
  }, [cycleScanSummary.totalProducts, finishedRows, selectedOperatorId]);

  const matchedCodeSetForLocation = useMemo(() => {
    const set = new Set<string>();
    if (!currentLocationId) return set;

    unfinishedRows.forEach((row) => {
      if (
        row.shopLocationId === currentLocationId &&
        row.isMatched &&
        getActivityDateKey(row.activityDate) === todayKey
      ) {
        const code = normalizeCodeValue(getFieldValue(row.itemCode));
        if (code) set.add(code);
      }
    });

    finishedRows.forEach((row) => {
      const hasNoDiff = Number(row.diffBottles || 0) === 0;
      if (
        row.shopLocationId === currentLocationId &&
        getActivityDateKey(row.activityDate) === todayKey &&
        (row.isMatched || hasNoDiff)
      ) {
        const code = normalizeCodeValue(getFieldValue(row.itemCode));
        if (code) set.add(code);
      }
    });

    return set;
  }, [unfinishedRows, finishedRows, currentLocationId, todayKey]);

  const itemFilterOptions = useMemo(() => {
    const itemMap = new Map<string, string>();
    masterRows.forEach((row) => {
      const itemCode = normalizeCodeValue(getFieldValue(row.itemCode));
      if (itemCode && matchedCodeSetForLocation.has(itemCode)) return;
      const itemName = getFieldValue(row.itemName).trim();
      if (!itemName) return;
      const key = itemName.toLowerCase();
      if (!itemMap.has(key)) {
        itemMap.set(key, itemName);
      }
    });
    return Array.from(itemMap.values()).sort((a, b) => a.localeCompare(b));
  }, [masterRows, matchedCodeSetForLocation]);

  const bestSellingCodeSet = useMemo(() => {
    const set = new Set<string>();
    bestSellingRows.forEach((row) => {
      const code = getFieldValue(row.itemCode).toLowerCase();
      if (code) set.add(code);
    });
    return set;
  }, [bestSellingRows]);

  const filteredOperators = useMemo(() => {
    const query = operatorSearchQuery.trim().toLowerCase();
    if (!query) return operators;
    return operators.filter((operator) => (operator.name || "").toLowerCase().includes(query));
  }, [operators, operatorSearchQuery]);

  const fastSellingGroupedResults = useMemo(() => {
    if (bestSellingCodeSet.size === 0) {
      return [] as GroupedSearchResult[];
    }

    const filteredItems = masterRows.filter((row) => {
      const code = getFieldValue(row.itemCode).toLowerCase();
      if (!code) return false;
      if (!bestSellingCodeSet.has(code)) return false;
      return !isMatchedItemForLocation(row);
    });

    const results: SearchResult[] = filteredItems.map((row) => ({
      ...row,
      matchScore: 1,
      matchType: "partial",
    }));

    return groupSearchResults(results);
  }, [bestSellingCodeSet, masterRows, matchedCodeSetForLocation]);

  const unmatchedGroupedResults = useMemo(() => {
    const filteredItems = masterRows.filter((row) => !isMatchedItemForLocation(row));
    const results: SearchResult[] = filteredItems.map((row) => ({
      ...row,
      matchScore: 1,
      matchType: "partial",
    }));
    return groupSearchResults(results);
  }, [masterRows, matchedCodeSetForLocation]);

  const filteredFastSellingGroupedResults = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    const minLength = mode === "barcode" ? 1 : 2;
    if (trimmed.length < minLength) {
      return fastSellingGroupedResults;
    }

    const tokens = splitSearchTokens(trimmed);
    return fastSellingGroupedResults.filter((group) => {
      const brand = (group.brandName || "").toLowerCase();
      const item = (group.itemName || "").toLowerCase();
      const combined = `${brand} ${item}`.trim();

      if (tokens.length > 1) {
        if (
          matchesAllSearchTokens(brand, tokens) ||
          matchesAllSearchTokens(item, tokens) ||
          matchesAllSearchTokens(combined, tokens)
        ) {
          return true;
        }
      }
      return matchesFlexibleSearch(brand, item, trimmed);
    });
  }, [fastSellingGroupedResults, mode, searchQuery]);

  const normalizedSearchItemFilterSet = useMemo(() => {
    return new Set(
      searchItemFilters.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    );
  }, [searchItemFilters]);

  const normalizedDraftSearchItemFilterSet = useMemo(() => {
    return new Set(
      draftSearchItemFilters.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    );
  }, [draftSearchItemFilters]);

  const isFastSellingSelected = normalizedSearchItemFilterSet.has(FAST_SELLING_FILTER);
  const hasNamedItemFilters = useMemo(() => {
    for (const value of searchItemFilters) {
      if (String(value || "").trim().toLowerCase() !== FAST_SELLING_FILTER) {
        return true;
      }
    }
    return false;
  }, [searchItemFilters]);

  const filteredGroupedResults = useMemo(() => {
    const minLength = mode === "barcode" ? 1 : 2;
    const shouldUseQuery = searchQuery.trim().length >= minLength;
    const searchableRows = shouldUseQuery ? groupedSearchResults : unmatchedGroupedResults;
    const namedRows = hasNamedItemFilters
      ? searchableRows.filter((group) =>
          normalizedSearchItemFilterSet.has((group.itemName || "").trim().toLowerCase())
        )
      : [];

    if (isFastSellingSelected && hasNamedItemFilters) {
      const fastRows = shouldUseQuery ? filteredFastSellingGroupedResults : fastSellingGroupedResults;
      return mergeGroupedResults([...fastRows, ...namedRows]);
    }

    if (isFastSellingSelected) {
      return shouldUseQuery ? filteredFastSellingGroupedResults : fastSellingGroupedResults;
    }

    if (hasNamedItemFilters) {
      return namedRows;
    }

    return searchableRows;
  }, [
    fastSellingGroupedResults,
    groupedSearchResults,
    filteredFastSellingGroupedResults,
    hasNamedItemFilters,
    isFastSellingSelected,
    mode,
    normalizedSearchItemFilterSet,
    searchQuery,
    unmatchedGroupedResults,
  ]);

  const selectedItemFilterText = useMemo(() => {
    if (searchItemFilters.length === 0) return "All";
    if (searchItemFilters.length === 1) {
      return searchItemFilters[0] === FAST_SELLING_FILTER ? "Fast Selling" : searchItemFilters[0];
    }
    return `${searchItemFilters.length} selected`;
  }, [searchItemFilters]);

  const selectedProductBpc = Number(selectedProduct?.bpc) || 12;
  const enteredCases = Number.parseInt(packQty || "0", 10) || 0;
  const enteredBottles = Number.parseInt(bottleQty || "0", 10) || 0;
  const enteredTotalBottles = enteredCases * selectedProductBpc + enteredBottles;
  const currentMasterBottles = selectedProduct
    ? getMasterStockBottles(selectedProduct, currentLocation)
    : 0;
  const diffBottles = enteredTotalBottles - currentMasterBottles;
  const stockValueDisplay = `${enteredCases}.${String(enteredBottles).padStart(2, "0")}`;

  const selectedProductPackSizes = useMemo(() => {
    if (!selectedProduct) return [] as SearchResult[];
    const brand = getFieldValue(selectedProduct.brandName).toLowerCase();
    const item = getFieldValue(selectedProduct.itemName).toLowerCase();
    const rows = masterRows
      .filter(
        (row) =>
          getFieldValue(row.brandName).toLowerCase() === brand &&
          getFieldValue(row.itemName).toLowerCase() === item
      )
      .map((row) => ({
        ...row,
        matchScore: 0,
        matchType: "partial" as const,
      }));

    return sortPackSizesDesc(rows);
  }, [masterRows, selectedProduct]);

  async function loadInitialData(): Promise<{
    cycleId: number | null;
    shopLocationId: number | null;
  }> {
    setLoadingMaster(true);
    try {
      const [master, cycleResult, locationRows, workerRows] = await Promise.all([
        getAllMasterProducts(10000),
        getCurrentCycle(),
        getShopLocations(),
        getWorkers(),
      ]);
      setMasterRows(master);
      setLocations(locationRows);
      setOperators(workerRows);
      const resolvedCycleId = cycleResult.active && cycleResult.cycle ? cycleResult.cycle.id : null;
      setActiveCycleId(resolvedCycleId);
      const rawLocationId = Number(localStorage.getItem(CURRENT_LOCATION_ID_KEY));
      const storedId = Number.isFinite(rawLocationId) && rawLocationId > 0 ? rawLocationId : null;
      const validStored =
        storedId && locationRows.some((location) => location.id === storedId) ? storedId : null;
      const fallback = validStored || locationRows[0]?.id || null;
      if (fallback) {
        localStorage.setItem(CURRENT_LOCATION_ID_KEY, String(fallback));
      }
      setCurrentLocationId(fallback);

      const storedOperatorIdRaw = Number(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
      const storedOperatorId =
        Number.isFinite(storedOperatorIdRaw) && storedOperatorIdRaw > 0
          ? Math.trunc(storedOperatorIdRaw)
          : null;
      const validOperator =
        storedOperatorId && workerRows.find((operator) => operator.id === storedOperatorId)
          ? storedOperatorId
          : null;

      if (validOperator) {
        const operatorRow = workerRows.find((operator) => operator.id === validOperator);
        setSelectedOperatorId(validOperator);
        localStorage.setItem(CURRENT_OPERATOR_ID_KEY, String(validOperator));
        localStorage.setItem(CURRENT_OPERATOR_NAME_KEY, operatorRow?.name || "");
      } else {
        setSelectedOperatorId(null);
        localStorage.removeItem(CURRENT_OPERATOR_ID_KEY);
        localStorage.removeItem(CURRENT_OPERATOR_NAME_KEY);
      }
      return {
        cycleId: resolvedCycleId,
        shopLocationId: fallback,
      };
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load stock entry data",
        color: "danger",
        duration: 1800,
      });
      return {
        cycleId: null,
        shopLocationId: null,
      };
    } finally {
      setLoadingMaster(false);
    }
  }

  async function loadUnfinishedRows(cycleId: number | null, shopLocationId: number | null) {
    if (!cycleId || !shopLocationId) {
      setUnfinishedRows([]);
      return;
    }
    try {
      const rows = await getUnfinishedStock(cycleId, shopLocationId);
      setUnfinishedRows(rows);
    } catch {
      setUnfinishedRows([]);
    }
  }

  async function loadFinishedRows(cycleId: number | null, shopLocationId: number | null) {
    if (!cycleId || !shopLocationId) {
      setFinishedRows([]);
      return;
    }
    try {
      const rows = await getFinishedStock(cycleId, shopLocationId);
      setFinishedRows(rows);
    } catch {
      setFinishedRows([]);
    }
  }

  async function loadFinishedProgress(cycleId: number | null, shopLocationId: number | null) {
    if (!cycleId || !shopLocationId) {
      setFinishedProgress(null);
      setLoadingFinishedProgress(false);
      return;
    }

    setLoadingFinishedProgress(true);
    try {
      const summary = await getFinishedProgressSummary({ cycleId, shopLocationId });
      setFinishedProgress(summary);
    } catch {
      setFinishedProgress(null);
    } finally {
      setLoadingFinishedProgress(false);
    }
  }

  async function loadBestSelling() {
    setIsLoadingBestSelling(true);
    try {
      const rows = await getBestSelling();
      setBestSellingRows(rows);
    } catch {
      setBestSellingRows([]);
    } finally {
      setIsLoadingBestSelling(false);
    }
  }

  async function loadMasterCsvStatus() {
    try {
      const status = await getMasterStatus();
      setMasterStatus(status);
      setMasterStatusCheckFailed(false);
    } catch {
      setMasterStatus(null);
      setMasterStatusCheckFailed(true);
    }
  }

  async function refreshDashboardData(showToast = false) {
    if (dashboardRefreshInFlightRef.current) {
      return;
    }

    dashboardRefreshInFlightRef.current = true;
    try {
      const [{ cycleId, shopLocationId }] = await Promise.all([loadInitialData(), loadMasterCsvStatus()]);
      await Promise.all([
        loadUnfinishedRows(cycleId, shopLocationId),
        loadFinishedRows(cycleId, shopLocationId),
        loadFinishedProgress(cycleId, shopLocationId),
      ]);
      if (isFastSellingSelected) {
        await loadBestSelling();
      }
      if (showToast) {
        presentToast({
          message: "Dashboard refreshed",
          color: "success",
          duration: 900,
        });
      }
    } finally {
      dashboardRefreshInFlightRef.current = false;
    }
  }

  async function handleDashboardRefresh(event: CustomEvent<{ complete: () => void }>) {
    try {
      await refreshDashboardData(true);
    } finally {
      event.detail.complete();
    }
  }

  useIonViewWillEnter(() => {
    void refreshDashboardData(false);
  });

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadMasterCsvStatus();
    const interval = setInterval(() => {
      void loadMasterCsvStatus();
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    void loadUnfinishedRows(activeCycleId, currentLocationId);
  }, [activeCycleId, currentLocationId]);

  useEffect(() => {
    void loadFinishedRows(activeCycleId, currentLocationId);
  }, [activeCycleId, currentLocationId]);

  useEffect(() => {
    void loadFinishedProgress(activeCycleId, currentLocationId);
  }, [activeCycleId, currentLocationId]);

  useEffect(() => {
    setSearchQuery("");
    setGroupedSearchResults([]);
    setShowSearchResults(false);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(SEARCH_ITEM_FILTER_KEY, JSON.stringify(searchItemFilters));
  }, [searchItemFilters]);

  useEffect(() => {
    const validItemMap = new Map(
      itemFilterOptions.map((itemName) => [itemName.trim().toLowerCase(), itemName])
    );
    setSearchItemFilters((previous) => {
      const nextValues: string[] = [];
      previous.forEach((value) => {
        const normalized = String(value || "").trim().toLowerCase();
        if (!normalized) return;
        if (normalized === FAST_SELLING_FILTER) {
          nextValues.push(FAST_SELLING_FILTER);
          return;
        }
        const matchedName = validItemMap.get(normalized);
        if (matchedName) {
          nextValues.push(matchedName);
        }
      });
      const uniqueValues = Array.from(new Set(nextValues));
      if (uniqueValues.length === previous.length && uniqueValues.every((value, index) => value === previous[index])) {
        return previous;
      }
      return uniqueValues;
    });
  }, [itemFilterOptions]);

  useEffect(() => {
    if (isFastSellingSelected) {
      void loadBestSelling();
    }
  }, [isFastSellingSelected]);

  useEffect(() => {
    function onLocationChanged(event: Event) {
      const custom = event as CustomEvent<ShopLocation>;
      const nextId = Number(custom.detail?.id);
      if (Number.isFinite(nextId) && nextId > 0) {
        setCurrentLocationId(nextId);
      }
    }
    window.addEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    return () => {
      window.removeEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isMasterBlocked) return;
    if (isScanning) {
      void stopScanning();
    }
    setShowStockModal(false);
    setShowPackSizeModal(false);
    setShowOperatorModal(false);
  }, [isMasterBlocked, isScanning]);

  useEffect(() => {
    return () => {
      void stopScanning();
      clearScanTimers();
    };
  }, []);

  function clearScanTimers() {
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }
  }

  async function checkScannerPermissions() {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }
    try {
      const existing = await BarcodeScanner.checkPermissions();
      const existingCamera = String((existing as { camera?: string })?.camera || "").toLowerCase();
      if (existingCamera === "granted") {
        return true;
      }

      const requested = await BarcodeScanner.requestPermissions();
      const requestedCamera = String((requested as { camera?: string })?.camera || "").toLowerCase();
      return requestedCamera === "granted";
    } catch {
      return false;
    }
  }

  function startCooldownTimer() {
    setCooldownTimeLeft(SCAN_RETRY_COOLDOWN_SECONDS);
    setCanScan(false);

    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownTimeLeft((previous) => {
        if (previous <= 1) {
          if (cooldownIntervalRef.current) {
            clearInterval(cooldownIntervalRef.current);
            cooldownIntervalRef.current = null;
          }
          setCanScan(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }

  async function addBarcodeListener() {
    await BarcodeScanner.addListener("barcodesScanned", (event: BarcodesScannedEvent) => {
      if (!canScan) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastScanTimeRef.current < SCAN_EVENT_DEBOUNCE_MS) {
        return;
      }
      lastScanTimeRef.current = currentTime;

      if (!event.barcodes || event.barcodes.length === 0) {
        return;
      }

      const barcode = event.barcodes[0];
      if (!SCAN_FORMATS.includes(barcode.format as (typeof SCAN_FORMATS)[number])) {
        return;
      }

      const barcodeValue = barcode.displayValue || barcode.rawValue || "";
      if (!barcodeValue.trim()) {
        return;
      }

      handleDetectedCode(barcodeValue);
      startCooldownTimer();
    });
  }

  async function removeBarcodeListener() {
    await BarcodeScanner.removeAllListeners();
  }

  async function applyDefaultScannerZoom() {
    if (Capacitor.getPlatform() !== "android") {
      return;
    }

    try {
      const [{ zoomRatio: minZoomRatio }, { zoomRatio: maxZoomRatio }] = await Promise.all([
        BarcodeScanner.getMinZoomRatio(),
        BarcodeScanner.getMaxZoomRatio(),
      ]);
      const targetZoomRatio = Math.min(
        maxZoomRatio,
        Math.max(minZoomRatio, DEFAULT_ANDROID_SCAN_ZOOM_RATIO)
      );

      if (Number.isFinite(targetZoomRatio) && targetZoomRatio > 0) {
        await BarcodeScanner.setZoomRatio({ zoomRatio: targetZoomRatio });
      }
    } catch {
      // Some devices do not expose zoom until the camera session is fully ready.
    }
  }

  async function startScanning() {
    if (!Capacitor.isNativePlatform()) {
      await startWebScanning();
      return;
    }

    const permissionGranted = await checkScannerPermissions();
    if (!permissionGranted) {
      setCameraError("Camera permission is required to scan barcodes.");
      presentToast({
        message: "Camera permission is required to scan barcodes",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    try {
      setCameraError("");

      const supportResult = await BarcodeScanner.isSupported();
      if (!supportResult.supported) {
        setCameraError("Barcode scanning not supported on this device.");
        presentToast({
          message: "Barcode scanning not supported on this device",
          color: "warning",
          duration: 1800,
        });
        return;
      }

      if (Capacitor.getPlatform() === "android") {
        try {
          const moduleAvailable = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
          if (!moduleAvailable.available) {
            await BarcodeScanner.installGoogleBarcodeScannerModule();
          }
        } catch {
          setCameraError("Error preparing barcode scanner.");
          presentToast({
            message: "Error preparing barcode scanner",
            color: "danger",
            duration: 1800,
          });
          return;
        }
      }

      setCanScan(true);
      setCooldownTimeLeft(0);
      lastScanTimeRef.current = 0;
      clearScanTimers();
      document.body.classList.add("barcode-scanner-active");

      await addBarcodeListener();
      await BarcodeScanner.startScan({ formats: [...SCAN_FORMATS] });
      await applyDefaultScannerZoom();
      setIsScanning(true);
    } catch (error) {
      await removeBarcodeListener();
      clearScanTimers();
      setCanScan(true);
      setCooldownTimeLeft(0);
      setIsScanning(false);
      document.body.classList.remove("barcode-scanner-active");
      const message = error instanceof Error ? error.message : "Error starting barcode scanner";
      setCameraError(message);
      presentToast({
        message: message.toLowerCase().includes("cancel")
          ? "Scanning cancelled"
          : "Error starting barcode scanner",
        color: "danger",
        duration: 1800,
      });
    }
  }

  async function stopScanning() {
    stopWebScanning();
    try {
      await BarcodeScanner.stopScan();
    } catch {
      // Scanner may already be stopped.
    }
    await removeBarcodeListener();
    clearScanTimers();
    setCanScan(true);
    setCooldownTimeLeft(0);
    lastScanTimeRef.current = 0;
    setIsScanning(false);
    document.body.classList.remove("barcode-scanner-active");
  }

  async function startWebScanning() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Camera not supported in this browser.";
      setCameraError(message);
      presentToast({ message, color: "warning", duration: 1800 });
      return;
    }

    if (!window.isSecureContext) {
      const message = getWebCameraErrorMessage(new Error("Insecure context"));
      setCameraError(message);
      presentToast({ message, color: "warning", duration: 2600 });
      return;
    }

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      permissionStream.getTracks().forEach((track) => track.stop());

      setCameraError("");
      lastScanTimeRef.current = 0;
      clearScanTimers();
      setCanScan(true);
      setCooldownTimeLeft(0);
      document.body.classList.add("barcode-scanner-active");
      setIsScanning(true);
    } catch (error) {
      const message = getWebCameraErrorMessage(error);
      setCameraError(message);
      presentToast({ message, color: "warning", duration: 2600 });
      setIsScanning(false);
      document.body.classList.remove("barcode-scanner-active");
    }
  }

  function stopWebScanning() {
    setCameraError("");
  }

  function handleWebScannerResult(detectedCodes: IDetectedBarcode[]) {
    if (Capacitor.isNativePlatform() || !isScanning) return;
    if (!detectedCodes || detectedCodes.length === 0) return;
    if (!canScan) return;

    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_EVENT_DEBOUNCE_MS) {
      return;
    }

    const detected = detectedCodes.find((code) => String(code.rawValue || "").trim()) || null;
    if (!detected) return;

    lastScanTimeRef.current = now;
    handleDetectedCode(detected.rawValue);
    startCooldownTimer();
  }

  function handleWebScannerError(error: unknown) {
    const message = getWebCameraErrorMessage(error);
    setCameraError(message);
    clearScanTimers();
    setCanScan(true);
    setCooldownTimeLeft(0);
    setIsScanning(false);
    document.body.classList.remove("barcode-scanner-active");
    presentToast({ message, color: "warning", duration: 2600 });
  }

  async function closeScannerAndExit() {
    await stopScanning();
    history.replace("/dashboard");
  }

  function getPrefillStockRow(product: MasterProduct) {
    if (!currentLocationId) return null;

    const normalizedCode = normalizeCodeValue(getFieldValue(product.itemCode));
    if (!normalizedCode) return null;

    const unfinishedMatches = unfinishedRows.filter(
      (row) =>
        normalizeCodeValue(getFieldValue(row.itemCode)) === normalizedCode &&
        row.shopLocationId === currentLocationId
    );
    if (unfinishedMatches.length > 0) {
      const latestUnfinished = unfinishedMatches.reduce((latest, row) => {
        const latestTime = new Date(
          latest.stateUpdatedAt || latest.updatedAt || latest.activityDate || latest.createdAt
        ).getTime();
        const rowTime = new Date(
          row.stateUpdatedAt || row.updatedAt || row.activityDate || row.createdAt
        ).getTime();
        return rowTime >= latestTime ? row : latest;
      });
      return { quantityBottles: latestUnfinished.quantityBottles, source: "unfinished" as const };
    }

    const finishedMatches = finishedRows.filter(
      (row) =>
        normalizeCodeValue(getFieldValue(row.itemCode)) === normalizedCode &&
        row.shopLocationId === currentLocationId
    );
    if (finishedMatches.length === 0) {
      return null;
    }

    const latestFinished = finishedMatches.reduce((latest, row) => {
      const latestTime = new Date(
        latest.updatedAt || latest.finishedAt || latest.activityDate || latest.createdAt
      ).getTime();
      const rowTime = new Date(
        row.updatedAt || row.finishedAt || row.activityDate || row.createdAt
      ).getTime();
      return rowTime >= latestTime ? row : latest;
    });

    return { quantityBottles: latestFinished.quantityBottles, source: "finished" as const };
  }

  function applyProductPrefill(product: MasterProduct) {
    const safeBpc = Number(product.bpc) || 12;
    const existing = getPrefillStockRow(product);
    if (existing) {
      const starting = bottlesToPackBottle(existing.quantityBottles, safeBpc);
      setPackQty(starting.packs ? String(starting.packs) : "");
      setBottleQty(starting.bottles ? String(starting.bottles) : "");
      pendingAutoPrefillRef.current = false;
      return true;
    }
    setPackQty("");
    setBottleQty("");
    pendingAutoPrefillRef.current = true;
    return false;
  }

  function openProductEditor(product: MasterProduct, source: "scan" | "manual" = "manual") {
    if (isMasterBlocked) {
      presentToast({
        message: "Product data is outdated. Update brands.csv to continue.",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    applyProductPrefill(product);
    setSelectedProduct(product);
    setShowStockModal(true);
  }

  useEffect(() => {
    if (!showStockModal || !selectedProduct || !pendingAutoPrefillRef.current) {
      return;
    }
    applyProductPrefill(selectedProduct);
  }, [showStockModal, selectedProduct, unfinishedRows, finishedRows, currentLocationId]);

  function handleDetectedCode(rawValue: string) {
    const normalized = rawValue.trim().toLowerCase();
    const matched =
      masterRows.find((row) => getFieldValue(row.barcode).toLowerCase() === normalized) ||
      masterRows.find((row) => getFieldValue(row.itemCode).toLowerCase() === normalized) ||
      null;

    if (matched) {
      void stopScanning();
      openProductEditor(matched, "scan");
      presentToast({ message: `Scanned ${matched.itemCode}`, color: "success", duration: 1200 });
      return;
    }
    presentToast({ message: "Barcode doesn't match any product", color: "warning", duration: 1400 });
  }

  function clearSearchAndResults() {
    setSearchQuery("");
    setGroupedSearchResults([]);
    setShowSearchResults(false);
    setSelectedGroup(null);
    setShowPackSizeModal(false);
  }

  function isMatchedItemForLocation(row: MasterProduct) {
    const itemCode = normalizeCodeValue(getFieldValue(row.itemCode));
    if (!itemCode) return false;
    return matchedCodeSetForLocation.has(itemCode);
  }

  function handleSearchChange(query: string) {
    if (isMasterBlocked) {
      return;
    }

    const resolvedMode: EntryMode = mode === "scan" ? "name" : mode;
    const sanitizedQuery = resolvedMode === "barcode" ? query.replace(/[^0-9.]/g, "") : query;
    setSearchQuery(sanitizedQuery);

    const trimmed = sanitizedQuery.trim().toLowerCase();
    const minLength = resolvedMode === "barcode" ? 1 : 2;
    if (trimmed.length < minLength) {
      setGroupedSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    if (resolvedMode === "barcode" && trimmed.includes(".")) {
      const exactMatch = masterRows.find((item) => getFieldValue(item.itemCode).toLowerCase() === trimmed);
      if (exactMatch && !isMatchedItemForLocation(exactMatch)) {
      openProductEditor(exactMatch, "manual");
        setShowSearchResults(false);
        return;
      }
    }

    const results = buildSearchResults(trimmed, resolvedMode, masterRows, isMatchedItemForLocation);
    const grouped = groupSearchResults(results);
    setGroupedSearchResults(grouped);
    setShowSearchResults(grouped.length > 0);
  }

  function handleItemFilterChange(value: string | string[] | null | undefined) {
    const nextValues = Array.isArray(value)
      ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const resolvedValues =
      nextValues.length === 0 || nextValues.includes(ALL_ITEMS_FILTER_VALUE)
        ? []
        : Array.from(new Set(nextValues));

    setSearchItemFilters(resolvedValues);

    const minLength = mode === "barcode" ? 1 : 2;
    if (searchQuery.trim().length >= minLength) {
      setShowSearchResults(true);
      return;
    }
    setShowSearchResults(false);
  }

  function toggleDraftItemFilterValue(value: string) {
    if (value === ALL_ITEMS_FILTER_VALUE) {
      setDraftSearchItemFilters([]);
      return;
    }

    const normalizedValue = value.trim().toLowerCase();
    setDraftSearchItemFilters((previous) => {
      const exists = previous.some((entry) => entry.trim().toLowerCase() === normalizedValue);
      if (exists) {
        return previous.filter((entry) => entry.trim().toLowerCase() !== normalizedValue);
      }
      return [...previous, value];
    });
  }

  function applyDraftItemFilters() {
    handleItemFilterChange(draftSearchItemFilters);
    setItemFilterPopoverOpen(false);
  }

  function handleOperatorChange(rawValue: string | number | null | undefined) {
    const parsed = Number(rawValue);
    const nextId = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
    setSelectedOperatorId(nextId);

    if (!nextId) {
      localStorage.removeItem(CURRENT_OPERATOR_ID_KEY);
      localStorage.removeItem(CURRENT_OPERATOR_NAME_KEY);
      return;
    }

    const operator = operators.find((row) => row.id === nextId);
    localStorage.setItem(CURRENT_OPERATOR_ID_KEY, String(nextId));
    localStorage.setItem(CURRENT_OPERATOR_NAME_KEY, operator?.name || "");
  }

  function onSelectGroup(group: GroupedSearchResult) {
    if (group.packSizes.length === 1) {
      openProductEditor(group.packSizes[0], "manual");
      clearSearchAndResults();
      return;
    }
    setSelectedGroup({
      ...group,
      packSizes: sortPackSizesDesc(group.packSizes),
    });
    setShowPackSizeModal(true);
  }

  function openSwitchPackSelector() {
    if (!selectedProduct || selectedProductPackSizes.length <= 1) return;
    setSelectedGroup({
      brandName: getFieldValue(selectedProduct.brandName),
      itemName: getFieldValue(selectedProduct.itemName),
      packSizes: selectedProductPackSizes,
      itemCodes: selectedProductPackSizes.map((row) => getFieldValue(row.itemCode)).filter(Boolean),
      matchScore: 0,
    });
    setShowPackSizeModal(true);
  }

  function onSelectPackSize(row: SearchResult) {
    const fromStockEditor = showStockModal;
    setShowPackSizeModal(false);
    setSelectedGroup(null);
    openProductEditor(row, "manual");
    if (!fromStockEditor) {
      setSearchQuery("");
      setGroupedSearchResults([]);
      setShowSearchResults(false);
    }
  }

  function handleModeChange(nextMode: EntryMode) {
    if (isMasterBlocked) {
      presentToast({
        message: "Product data is outdated. Update brands.csv to continue.",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    if (!selectedOperatorId) {
      presentToast({
        message: "Select operator first",
        color: "warning",
        duration: 1400,
      });
      return;
    }
    setMode(nextMode);
    if (nextMode !== "scan" && isScanning) {
      void stopScanning();
    }
  }

  function incrementCases() {
    pendingAutoPrefillRef.current = false;
    const next = (Number.parseInt(packQty || "0", 10) || 0) + 1;
    setPackQty(String(next));
  }

  function decrementCases() {
    pendingAutoPrefillRef.current = false;
    const current = Number.parseInt(packQty || "0", 10) || 0;
    const next = Math.max(0, current - 1);
    setPackQty(next > 0 ? String(next) : "");
  }

  function incrementBottles() {
    pendingAutoPrefillRef.current = false;
    const next = (Number.parseInt(bottleQty || "0", 10) || 0) + 1;
    setBottleQty(String(next));
  }

  function decrementBottles() {
    pendingAutoPrefillRef.current = false;
    const current = Number.parseInt(bottleQty || "0", 10) || 0;
    const next = Math.max(0, current - 1);
    setBottleQty(next > 0 ? String(next) : "");
  }

  async function saveStock() {
    if (isMasterBlocked) {
      presentToast({
        message: "Product data is outdated. Update brands.csv to continue.",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    if (!selectedProduct) return;
    if (!selectedOperatorId) {
      presentToast({ message: "Select operator first", color: "warning", duration: 1500 });
      return;
    }
    if (!activeCycleId) {
      presentToast({ message: "No active cycle. Start a cycle first.", color: "warning", duration: 1800 });
      return;
    }
    if (!currentLocationId) {
      presentToast({ message: "Select a shop location first.", color: "warning", duration: 1800 });
      return;
    }
    const currentPhoneId = getCurrentPhoneIdFromStorage();
    if (!currentPhoneId) {
      presentToast({
        message: "Select current phone in Settings -> Phones",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    const safeBpc = Number(selectedProduct.bpc) || 12;
    const quantityBottles = enteredCases * safeBpc + enteredBottles;
    const currentStockBottles = getMasterStockBottles(selectedProduct, currentLocation);
    const hasMismatch = quantityBottles !== currentStockBottles;
    const promptKey = `${activeCycleId}|${currentLocationId}|${todayKey}|${selectedProduct.itemCode}`;
    const alreadyInUnfinished = unfinishedRows.some(
      (row) =>
        row.cycleId === activeCycleId &&
        row.itemCode === selectedProduct.itemCode &&
        row.shopLocationId === currentLocationId &&
        getActivityDateKey(row.activityDate) === todayKey
    );
    const alreadyInFinished = finishedRows.some(
      (row) =>
        row.cycleId === activeCycleId &&
        row.itemCode === selectedProduct.itemCode &&
        row.shopLocationId === currentLocationId &&
        getActivityDateKey(row.activityDate) === todayKey
    );
    const isFirstTimeProductToday = !alreadyInUnfinished && !alreadyInFinished;
    const shouldShowRecheck =
      hasMismatch && isFirstTimeProductToday && !recheckPromptShownRef.current.has(promptKey);

    const persistSave = async () => {
      setSaving(true);
      try {
        await upsertUnfinishedStock({
          cycleId: activeCycleId,
          itemCode: selectedProduct.itemCode,
          itemName: selectedProduct.itemName,
          brandName: selectedProduct.brandName || selectedProduct.itemCode,
          packValue: selectedProduct.packValue,
          bpc: selectedProduct.bpc ?? null,
          mrp: selectedProduct.mrp ?? null,
          barcode: selectedProduct.barcode || undefined,
          phoneId: currentPhoneId,
          shopLocationId: currentLocationId,
          activityDate: todayKey,
          quantityBottles,
          currentStockBottles,
          lastUpdatedByWorkerId: selectedOperatorId,
          recheckShown: false,
        });
        await loadUnfinishedRows(activeCycleId, currentLocationId);
        presentToast({ message: "Stock saved to unfinished.", color: "success", duration: 1400 });
        setShowStockModal(false);
        setSelectedProduct(null);
      } catch (error) {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to save stock",
          color: "danger",
          duration: 1800,
        });
      } finally {
        setSaving(false);
      }
    };

    if (shouldShowRecheck) {
      recheckPromptShownRef.current.add(promptKey);
      presentStockMismatchAlert({
        header: "⚠️ Stock Mismatch",
        message: "Mismatch detected , Do you want to recheck?",
        buttons: [
          {
            text: "Yes Recheck",
            role: "cancel",
          },
          {
            text: "No Save",
            handler: () => {
              void persistSave();
            },
          },
        ],
      });
      return;
    }

    await persistSave();
  }

  return (
    <IonPage>
      {!isScanning ? <AppTopBar title="Stock Entry" showBack={false} showSettings /> : null}
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content stock-dashboard-content">
        {isScanning && !Capacitor.isNativePlatform() ? (
          <div className="web-scanner-layer">
            <WebBarcodeScanner
              onScan={handleWebScannerResult}
              onError={handleWebScannerError}
              formats={WEB_SCAN_FORMATS}
              allowMultiple={true}
              scanDelay={250}
              sound={false}
              constraints={{ facingMode: { ideal: "environment" } }}
              components={{ finder: false, onOff: false, torch: false, zoom: false }}
              styles={{ container: { width: "100%", height: "100%" }, video: { objectFit: "cover" } }}
              classNames={{ container: "web-scanner-container", video: "web-scanner-video" }}
            >
              <div className="web-scanner-frame" />
            </WebBarcodeScanner>
          </div>
        ) : null}
        {isScanning ? (
          <div className="scan-close-overlay">
            <IonButton className="scan-close-button" onClick={() => void closeScannerAndExit()}>
              <IonIcon icon={closeOutline} slot="start" />
              Close
            </IonButton>
          </div>
        ) : null}
        {!isScanning ? (
          <>
            <IonRefresher slot="fixed" onIonRefresh={handleDashboardRefresh}>
              <IonRefresherContent
                pullingText="Pull to refresh"
                refreshingSpinner="crescent"
                refreshingText="Refreshing..."
              />
            </IonRefresher>
            <div className="dashboard-stack dashboard-stack-compact">
              {isMasterBlocked ? (
                <div className="dashboard-block master-status-block is-blocked">
                  <h3>Access Blocked</h3>
                  {masterStatusCheckFailed ? (
                    <p>Unable to verify product data status. Please check backend and try again.</p>
                  ) : (
                    <>
                      <p>
                        brands.csv was last modified {masterStatus?.ageMinutes ?? "-"} minutes ago (max{" "}
                        {masterStatus?.maxAgeMinutes ?? "-"} minutes).
                      </p>
                      <p>Last modified: {masterStatus?.lastModifiedIST || masterStatus?.lastModified || "-"}</p>
                    </>
                  )}
                </div>
              ) : null}

          <div className="dashboard-operator-block dashboard-operator-compact">
            <IonButton
              className="operator-picker-open-btn operator-picker-compact-btn operator-top-dropdown-btn"
              expand="block"
              disabled={isMasterBlocked}
              onClick={() => {
                setOperatorSearchQuery("");
                setShowOperatorModal(true);
              }}
            >
              <span className="operator-top-dropdown-text">
                {selectedOperator?.name || "Select Operator"}
              </span>
              <IonIcon icon={chevronForwardOutline} className="operator-dropdown-icon" />
            </IonButton>
          </div>

		          <div className="dashboard-block dashboard-search-unified-block">
              <div className="search-unified-topbar">
                <span className="search-unified-title">Finished (Scanned/Total)</span>
                <span className="search-unified-chip">
                  {loadingFinishedProgress
                    ? "..."
                    : `${cycleScanSummary.scannedCount}/${cycleScanSummary.totalProducts}`}
                </span>
              </div>
              <div className="cycle-summary-grid">
                <div className="cycle-summary-card cycle-summary-card-scanned">
                  <span className="cycle-summary-label">Scanned</span>
                  <span className="cycle-summary-value">
                    {loadingFinishedProgress
                      ? "..."
                      : `${operatorScanSummary.scannedCount}/${operatorScanSummary.totalProducts}`}
                  </span>
                </div>
                <div className="cycle-summary-card cycle-summary-card-matched">
                  <span className="cycle-summary-label">Matched</span>
                  <span className="cycle-summary-value">
                    {loadingFinishedProgress
                      ? "..."
                      : `${operatorScanSummary.matchedCount}/${operatorScanSummary.operatorTotalProducts}`}
                  </span>
                </div>
                <div className="cycle-summary-card cycle-summary-card-mismatched">
                  <span className="cycle-summary-label">Mismatched</span>
                  <span className="cycle-summary-value">
                    {loadingFinishedProgress
                      ? "..."
                      : `${operatorScanSummary.mismatchedCount}/${operatorScanSummary.operatorTotalProducts}`}
                  </span>
                </div>
              </div>
              <div className="dashboard-search-sticky-shell">
                <div className="dashboard-mode-block dashboard-search-section">
                  <IonSegment
                    value={mode}
                    onIonChange={(event) => handleModeChange((event.detail.value as EntryMode) || "name")}
                    className="mode-segment"
                    disabled={isMasterBlocked || !selectedOperatorId || operators.length === 0}
                  >
                    <IonSegmentButton value="scan" className="segment-button">
                      <IonIcon icon={scanOutline} />
                    </IonSegmentButton>
                    <IonSegmentButton value="barcode" className="segment-button">
                      <span className="segment-number-icon">123</span>
                    </IonSegmentButton>
                    <IonSegmentButton value="name" className="segment-button">
                      <IonIcon icon={textOutline} />
                    </IonSegmentButton>
                  </IonSegment>
                </div>

                <div className="dashboard-search-top-block dashboard-search-section">
                  {mode !== "scan" ? (
                    <div className="search-filter-row">
                      <IonItem
                        lines="none"
                        className="search-filter-item search-filter-item-button"
                        button={true}
                        detail={false}
                        disabled={isMasterBlocked || !selectedOperatorId}
                        onClick={(event) => {
                          setItemFilterPopoverEvent(event.nativeEvent);
                          setDraftSearchItemFilters(searchItemFilters);
                          setItemFilterPopoverOpen(true);
                        }}
                      >
                        <IonLabel>Item</IonLabel>
                        <span className="search-filter-item-value">{selectedItemFilterText}</span>
                        <IonIcon icon={chevronForwardOutline} className="search-filter-item-chevron" />
                      </IonItem>
                      <IonButton
                        fill="solid"
                        className="search-filter-cancel-btn"
                        disabled={isMasterBlocked || !selectedOperatorId || searchItemFilters.length === 0}
                        onClick={() => handleItemFilterChange([ALL_ITEMS_FILTER_VALUE])}
                      >
                        Cancel
                      </IonButton>
                    </div>
                  ) : null}

                  <div className="search-wrapper">
                    <IonIcon icon={searchOutline} className="search-input-icon" />
                    <IonInput
                      className="stock-search-input"
                      value={searchQuery}
                      disabled={isMasterBlocked || !selectedOperatorId || loadingMaster}
                      placeholder={mode === "barcode" ? "Enter item code (e.g. 233.1)" : "Search name/brand"}
                      inputMode={mode === "barcode" ? "decimal" : "text"}
                      onIonInput={(event) => {
                        const value = event.detail.value || "";
                        handleSearchChange(value);
                      }}
                    />
                  </div>
                </div>
              </div>

            {loadingMaster ? (
              <div className="dashboard-loading-block dashboard-search-section dashboard-search-results-section">
                <div className="search-section-head">
                  <span>Results</span>
                </div>
                <div className="stock-loading-wrap">
                  <IonSpinner name="crescent" />
                  <IonText>Loading products...</IonText>
                </div>
              </div>
            ) : null}

            {!selectedOperatorId ? (
              <div className="dashboard-entry-panel operator-required-box dashboard-search-section dashboard-search-results-section">
                <div className="search-section-head">
                  <span>Results</span>
                </div>
                Select operator to continue.
              </div>
            ) : mode === "scan" ? (
              <div className="dashboard-entry-panel scan-mode-content dashboard-search-section dashboard-search-results-section">
                <div className="search-section-head">
                  <span>Scan Feed</span>
                </div>
                <IonItem lines="none" className="stock-info-item">
                  <IonLabel>
                    <h3>Scan Mode</h3>
	                    <p>
	                      {isScanning
	                        ? `Scanner is active${cooldownTimeLeft > 0 ? ` (${cooldownTimeLeft}s)` : ""}.`
	                        : ""}
	                    </p>
	                  </IonLabel>
                  {currentLocation ? (
                    <IonBadge
                      className="location-badge"
                      style={{ "--shop-color": currentLocation.locationColor } as CSSProperties}
                    >
                      {currentLocation.locationName}
                    </IonBadge>
                  ) : null}
                </IonItem>
                {cameraError ? <div className="stock-empty">{cameraError}</div> : null}

                {showSearchResults && filteredGroupedResults.length > 0 ? (
                  <div className="search-results-container">
	                    {filteredGroupedResults.map((group, index) => (
	                      <div key={`${group.brandName}-${group.itemName}-${index}`} className="search-result-items" onClick={() => onSelectGroup(group)}>
	                        <div className="result-main">
	                          <div className="result-single-line">
	                            <span className="result-brand-text">{group.brandName}</span>
	                            <span className="result-divider"> | </span>
	                            <span className="result-code-text">
	                              Code: {group.itemCodes.slice(0, 2).join(", ")}
	                              {group.itemCodes.length > 2 ? "..." : ""}
	                            </span>
	                          </div>
	                        </div>
	                      </div>
	                    ))}
                  </div>
                ) : showSearchResults && searchQuery.trim().length >= 2 ? (
                  <div className="stock-empty">No products found.</div>
                ) : (
                  <div className="stock-empty">Scan a barcode to open the product.</div>
                )}
              </div>
            ) : showSearchResults && filteredGroupedResults.length > 0 ? (
              <div className="dashboard-entry-panel search-mode-content dashboard-search-section dashboard-search-results-section">
                <div className="search-section-head">
                  <span>Results</span>
                </div>
                <div className="search-results-container">
	                  {filteredGroupedResults.map((group, index) => (
	                    <div key={`${group.brandName}-${group.itemName}-${index}`} className="search-result-items" onClick={() => onSelectGroup(group)}>
	                      <div className="result-main">
	                        <div className="result-single-line">
	                          <span className="result-brand-text">{group.brandName}</span>
	                          <span className="result-divider"> | </span>
	                          <span className="result-code-text">
	                            Code: {group.itemCodes.slice(0, 2).join(", ")}
	                            {group.itemCodes.length > 2 ? "..." : ""}
	                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

              <div className="dashboard-block dashboard-actions-block dashboard-actions-compact">
                <div className="dashboard-actions-grid compact-grid">
                  <IonButton
                    className="operator-nil-nav-btn"
                    disabled={isMasterBlocked}
                    onClick={() => history.push("/stock/nil")}
                  >
                    NIL
                  </IonButton>
                  <IonButton
                    className="operator-finish-nav-btn"
                    disabled={isMasterBlocked || !selectedOperatorId || !activeCycleId}
                    onClick={() => {
                      if (!selectedOperatorId) {
                        presentToast({ message: "Select operator first", color: "warning", duration: 1400 });
                        return;
                      }
                      history.push(`/stock/finish?operatorId=${encodeURIComponent(String(selectedOperatorId))}`);
                    }}
                  >
                    FINISH
                  </IonButton>
                  <IonButton
                    className="operator-verify-nav-btn"
                    disabled={isMasterBlocked || !selectedOperatorId || !activeCycleId}
                    onClick={() => {
                      if (!selectedOperatorId) {
                        presentToast({ message: "Select operator first", color: "warning", duration: 1400 });
                        return;
                      }
                      history.push(`/stock/verify?operatorId=${encodeURIComponent(String(selectedOperatorId))}`);
                    }}
                  >
                    UNMATCH
                  </IonButton>
                  <IonButton
                    className="operator-unchecked-nav-btn"
                    disabled={isMasterBlocked || !activeCycleId || !currentLocationId}
                    onClick={() => history.push("/stock/unchecked")}
                  >
                    UNCHECK
                  </IonButton>
                  <IonButton
                    className="operator-diff-nav-btn"
                    disabled={isMasterBlocked || !activeCycleId || !currentLocationId}
                    onClick={() => history.push("/stock/difference")}
                  >
                    DIFF
                  </IonButton>
                  <IonButton
                    className="operator-fast-nav-btn"
                    disabled={isMasterBlocked}
                    onClick={() => history.push("/stock/fast-moving")}
                  >
                    FAST
                  </IonButton>
                  <IonButton
                    className="operator-low-nav-btn"
                    disabled={isMasterBlocked}
                    onClick={() =>
                      history.push(
                        currentLocationId
                          ? `/stock/low-stock?shopLocationId=${encodeURIComponent(String(currentLocationId))}`
                          : "/stock/low-stock"
                      )
                    }
                  >
                    LOW STOCK
                  </IonButton>
                  <IonButton
                    className="operator-print-nav-btn"
                    disabled={isMasterBlocked}
                    onClick={() => history.push("/stock/print")}
                  >
                    PRINT
                  </IonButton>
                  <IonButton
                    className={`operator-cycle-nav-btn ${isCycleActive ? "is-active" : "is-inactive"}`}
                    disabled={isMasterBlocked}
                    onClick={() => history.push("/cycles")}
                  >
                    CYCLE
                  </IonButton>
                </div>
              </div>

            </div>

            <IonFab vertical="bottom" horizontal="end" slot="fixed" className="scan-fab">
              <IonFabButton
                className={`fab-button ${mode === "scan" ? "" : "fab-disabled"} ${isScanning ? "scanning" : ""}`}
                color={mode === "scan" ? (isScanning ? "danger" : "primary") : "medium"}
                disabled={isMasterBlocked || mode !== "scan" || !selectedOperatorId}
                onClick={() => {
                  if (isScanning) {
                    void stopScanning();
                    return;
                  }
                  void startScanning();
                }}
              >
                <IonIcon icon={isScanning ? stopOutline : cameraOutline} />
              </IonFabButton>
            </IonFab>
          </>
        ) : null}
      </IonContent>

      <IonPopover
        isOpen={itemFilterPopoverOpen}
        event={itemFilterPopoverEvent}
        onDidDismiss={() => {
          setItemFilterPopoverOpen(false);
          setDraftSearchItemFilters(searchItemFilters);
        }}
        className="search-filter-popover"
      >
        <div className="search-filter-popover-content">
          <div className="search-filter-popover-actions">
            <IonButton
              size="small"
              fill="clear"
              onClick={() => {
                setDraftSearchItemFilters(searchItemFilters);
                setItemFilterPopoverOpen(false);
              }}
            >
              Close
            </IonButton>
            <IonButton size="small" onClick={applyDraftItemFilters}>
              Apply
            </IonButton>
          </div>
          <button
            type="button"
            className="search-filter-popover-row"
            onClick={() => toggleDraftItemFilterValue(ALL_ITEMS_FILTER_VALUE)}
          >
            <input type="checkbox" readOnly checked={draftSearchItemFilters.length === 0} />
            <span>All</span>
          </button>
          <button
            type="button"
            className="search-filter-popover-row"
            onClick={() => toggleDraftItemFilterValue(FAST_SELLING_FILTER)}
          >
            <input type="checkbox" readOnly checked={normalizedDraftSearchItemFilterSet.has(FAST_SELLING_FILTER)} />
            <span>{isLoadingBestSelling ? "Fast Selling..." : "Fast Selling"}</span>
          </button>
          {itemFilterOptions.map((itemName) => {
            const checked = normalizedDraftSearchItemFilterSet.has(itemName.trim().toLowerCase());
            return (
              <button
                type="button"
                key={itemName}
                className="search-filter-popover-row"
                onClick={() => toggleDraftItemFilterValue(itemName)}
              >
                <input type="checkbox" readOnly checked={checked} />
                <span>{itemName}</span>
              </button>
            );
          })}
        </div>
      </IonPopover>

      <IonModal
        isOpen={showOperatorModal}
        onDidDismiss={() => {
          setShowOperatorModal(false);
          void refreshDashboardData(false);
        }}
        className="operator-select-modal"
        breakpoints={[0, 0.84]}
        initialBreakpoint={0.84}
        handle={false}
      >
        <IonContent fullscreen className="operator-select-modal-content">
          <div className="operator-select-header">
            <h2>Select Operator</h2>
            <button
              type="button"
              className="operator-select-close-btn"
              onClick={() => setShowOperatorModal(false)}
            >
              CLOSE
            </button>
          </div>
          <div className="operator-select-body">
            <IonSearchbar
              className="operator-select-modal-search"
              value={operatorSearchQuery}
              placeholder="Search operator..."
              debounce={100}
              onIonInput={(event) => setOperatorSearchQuery(event.detail.value || "")}
            />
            <div className="operator-select-list">
              {filteredOperators.length === 0 ? (
                <div className="operator-select-empty">No operators found.</div>
              ) : (
                filteredOperators.map((operator) => (
                  <button
                    type="button"
                    key={operator.id}
                    className={`operator-select-row ${selectedOperatorId === operator.id ? "selected" : ""}`}
                    onClick={() => {
                      handleOperatorChange(operator.id);
                      setShowOperatorModal(false);
                    }}
                  >
                    {operator.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={showPackSizeModal && Boolean(selectedGroup)}
        onDidDismiss={() => {
          setShowPackSizeModal(false);
          setSelectedGroup(null);
          void refreshDashboardData(false);
        }}
        className="pack-size-modal"
        breakpoints={[0, 0.94]}
        initialBreakpoint={0.94}
        handle={true}
      >
        <IonContent fullscreen className="pack-size-modal-content">
          <div className="pack-size-header">
            <h2>Select Pack Size</h2>
            <IonButton fill="clear" onClick={() => setShowPackSizeModal(false)}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <div className="pack-size-product-head">
            <h3>{selectedGroup?.brandName || "-"}</h3>
            <p>{selectedGroup?.itemName || "-"}</p>
          </div>

          <div className="pack-size-list">
            {selectedGroup?.packSizes.map((row) => (
              <button
                type="button"
                key={`${row.itemCode}-${row.packValue}`}
                className={`pack-size-row ${selectedProduct?.itemCode === row.itemCode ? "active" : ""}`}
                onClick={() => onSelectPackSize(row)}
              >
                <div className="pack-size-row-main">
                  <div className="pack-size-title">{getFieldValue(row.packValue)}ml</div>
                  <div className="pack-size-meta">
                    BPC: {row.bpc ?? "-"} | MRP: {formatCurrency(row.mrp)} | Code: {getFieldValue(row.itemCode)}
                  </div>
                </div>
                <IonIcon icon={chevronForwardOutline} className="pack-size-arrow" />
              </button>
            ))}
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={showStockModal}
        onDidDismiss={() => {
          setShowStockModal(false);
          void refreshDashboardData(false);
        }}
        className="stock-editor-modal"
        breakpoints={[0, 0.96]}
        initialBreakpoint={0.96}
        handle={true}
      >
        <IonContent fullscreen className="stock-editor-modal-content">
          <div className="stock-sheet-header">
            <h2>Enter Stock Quantity</h2>
            <IonButton fill="clear" onClick={() => setShowStockModal(false)}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <div className="stock-sheet-product">
            <div>
              <h3>{selectedProduct?.brandName || "-"}</h3>
              <div className="stock-sheet-pack-line">
                <strong>{getFieldValue(selectedProduct?.packValue)}ml</strong>
                {selectedProductPackSizes.length > 1 ? (
                  <button type="button" className="stock-switch-btn" onClick={openSwitchPackSelector}>
                    <IonIcon icon={swapHorizontalOutline} />
                    Switch
                  </button>
                ) : null}
              </div>
              <p className="stock-sheet-code">Code: {getFieldValue(selectedProduct?.itemCode)}</p>
            </div>
            <IonButton
              className="stock-save-top-btn"
              color="success"
              onClick={() => void saveStock()}
              disabled={saving || !selectedProduct}
            >
              {saving ? "Saving..." : "Save"}
            </IonButton>
          </div>

          <div className="stock-step-card stock-step-card-cases">
            <div className="stock-step-title">
              <IonIcon icon={cubeOutline} />
              Cases
            </div>
            <div className="stock-stepper">
              <button type="button" onClick={decrementCases} className="stock-step-btn">
                <IonIcon icon={removeOutline} />
              </button>
              <IonInput
                className="stock-step-input"
                type="text"
                value={packQty}
                placeholder="0"
                inputMode="numeric"
                pattern="[0-9]*"
                onIonInput={(event) => {
                  pendingAutoPrefillRef.current = false;
                  setPackQty(String(event.detail.value || "").replace(/\D/g, ""));
                }}
              />
              <button type="button" onClick={incrementCases} className="stock-step-btn">
                <IonIcon icon={addOutline} />
              </button>
            </div>
          </div>

          <div className="stock-step-card stock-step-card-bottles">
            <div className="stock-step-title">
              <IonIcon icon={wineOutline} />
              Bottle
            </div>
            <div className="stock-stepper">
              <button type="button" onClick={decrementBottles} className="stock-step-btn">
                <IonIcon icon={removeOutline} />
              </button>
              <IonInput
                className="stock-step-input"
                type="text"
                value={bottleQty}
                placeholder="0"
                inputMode="numeric"
                pattern="[0-9]*"
                onIonInput={(event) => {
                  pendingAutoPrefillRef.current = false;
                  setBottleQty(String(event.detail.value || "").replace(/\D/g, ""));
                }}
              />
              <button type="button" onClick={incrementBottles} className="stock-step-btn">
                <IonIcon icon={addOutline} />
              </button>
            </div>
          </div>

          <div className="stock-summary-card stock-summary-card-total">
            <h4>Stock Summary</h4>
            <div className="stock-summary-grid">
              <div>
                <span>CASES</span>
                <strong>{enteredCases}</strong>
              </div>
              <div>
                <span>BOTTLES</span>
                <strong>{enteredBottles}</strong>
              </div>
              <div>
                <span>TOTAL BOTTLES</span>
                <strong>{enteredTotalBottles}</strong>
              </div>
            </div>
            <div className="stock-value-box">
              <span>Stock Value</span>
              <strong>{stockValueDisplay}</strong>
            </div>
          </div>

          <IonButton
            expand="block"
            fill="outline"
            className="stock-cancel-btn"
            onClick={() => setShowStockModal(false)}
          >
            Cancel
          </IonButton>
        </IonContent>
      </IonModal>
    </IonPage>
  );
}
