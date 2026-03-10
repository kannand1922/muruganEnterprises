import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonBadge,
  IonModal,
  IonButtons,
  IonToast,
  useIonViewWillEnter,
  IonRefresher,
  IonRefresherContent,
  IonAlert,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSearchbar,
  IonList,
  IonItem,
  IonNote,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import { settingsOutline } from "ionicons/icons";
import {
  BarcodeScanner,
  BarcodesScannedEvent,
} from "@capacitor-mlkit/barcode-scanning";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import "./BarcodeScanner.css";
import { getAllPrinters, getBrands, getProducts } from "../api/server";
import {
  AddOnItem,
  BrandItem,
  EnhancedScannedBarcode,
  Printer,
  QuantityMode,
  SelectedAddOn,
} from "../components/barcodeScannerTypes";
import { chevronDownCircleOutline } from "ionicons/icons";
import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  playBeepSound,
  setApiBaseUrl,
} from "../components/barcodeScannerUtils";
import {
  checkPermissions,
  processBarcodeResult,
  toggleAddOn,
  updateAddOnQuantity,
  getStatistics,
  setupBackButtonHandler,
  cleanupBackButtonHandler,
} from "../components/barcodeScannerHelpers";
import ScannerControls from "../components/ScannerControls";
import ScannedItemsList from "../components/ScannedItemsList";
import AddOnsList from "../components/AddOnsList";
import SettingsModal from "../components/SettingsModal";
import AddOnModal from "../components/AddOnModal";
import PrintModal from "../components/PrintModal";
import QuantityPopover from "../components/QuantityPopover";
import AddOnQuantityPopover from "../components/AddOnQuantityPopover";
import QuantityModal from "../components/QuantityPopover";
import AddOnQuantityModal from "../components/AddOnQuantityPopover";

type DataEntryMode = "scan" | "barcode" | "name";

interface SearchResult extends BrandItem {
  matchScore: number;
  matchType: "exact" | "partial" | "abbreviation";
}

interface ManualResultGroup {
  brandName: string;
  itemName: string;
  packOptions: SearchResult[];
  matchScore: number;
  matchType: "exact" | "partial" | "abbreviation";
}

const LAST_BILL_STORAGE_KEY = "myapp_last_bill_number";

const BarcodeScannerPage: React.FC = () => {
  const [scannedBarcodes, setScannedBarcodes] = useState<
    EnhancedScannedBarcode[]
  >([]);
  const [selectedBarcodeIds, setSelectedBarcodeIds] = useState<string[]>([]);
  const [manuallyDeselectedIds, setManuallyDeselectedIds] = useState<string[]>(
    []
  );
  const [isScanning, setIsScanning] = useState(false);
  const [showCompleteAlert, setShowCompleteAlert] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastDuration, setToastDuration] = useState(1500);

  // API Data states
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [brandItems, setBrandItems] = useState<BrandItem[]>([]);
  const [addOnItems, setAddOnItems] = useState<AddOnItem[]>([]);

  // Modal states
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [showAddOnModal, setShowAddOnModal] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);

  // Settings states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState("");
  const [currentApiUrl, setCurrentApiUrl] = useState("");
  const [lastBillNumber, setLastBillNumber] = useState("");

  // Enhanced cooldown states
  const [canScan, setCanScan] = useState(true);
  const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);
  const scanCooldownRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const processedBarcodesRef = useRef<Set<string>>(new Set());

  // Quantity management states
  const [showQuantityPopover, setShowQuantityPopover] = useState(false);
  const [selectedBarcodeId, setSelectedBarcodeId] = useState<string>("");
  const [customQuantity, setCustomQuantity] = useState<string>("1");
  const [quantityMode, setQuantityMode] = useState<QuantityMode>("auto");

  // Add-on quantity management states
  const [showAddOnQuantityPopover, setShowAddOnQuantityPopover] =
    useState(false);
  const [selectedAddOnIndex, setSelectedAddOnIndex] = useState<number>(-1);
  const [addOnCustomQuantity, setAddOnCustomQuantity] = useState<string>("0");

  const [dataEntryMode, setDataEntryMode] = useState<DataEntryMode>("scan");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualResults, setManualResults] = useState<SearchResult[]>([]);
  const [manualSelection, setManualSelection] = useState<BrandItem | null>(
    null
  );
  const [selectedItemFilter, setSelectedItemFilter] = useState("all");
  const [manualSelectionMode, setManualSelectionMode] =
    useState<DataEntryMode>("barcode");
  const [showManualQuantityModal, setShowManualQuantityModal] = useState(false);
  const [manualQuantity, setManualQuantity] = useState("1");
  const [showPackSizeModal, setShowPackSizeModal] = useState(false);
  const [selectedManualGroup, setSelectedManualGroup] =
    useState<ManualResultGroup | null>(null);

  const getFieldValue = (item: BrandItem, keys: string[]): string => {
    for (const key of keys) {
      const value = (item as unknown as Record<string, any>)[key];
      if (value !== undefined && value !== null && value !== "") {
        return value.toString();
      }
    }
    return "";
  };

  const getBrandName = (item: BrandItem) =>
    getFieldValue(item, ["Brand", "BRAND", "BRAND NAME"]);
  const getItemName = (item: BrandItem) =>
    getFieldValue(item, ["Item", "ITEM"]);
  const getPackValue = (item: BrandItem) =>
    getFieldValue(item, ["Pack", "PACK"]);
  const getBarcodeValue = (item: BrandItem) =>
    getFieldValue(item, ["BarCode", "BARCODE", "Barcode", "barCode"]);
  const getItemCodeValue = (item: BrandItem) =>
    getFieldValue(item, ["Code", "CODE", "Item Code", "ITEM CODE"]) ||
    getBarcodeValue(item);
  const getMrpValue = (item: BrandItem) => getFieldValue(item, ["MRP"]);
  const getBrandInitials = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("");

  const normalizeCodeValue = (value: string) => value.trim().toLowerCase();

  const normalizeSearchText = (value: string) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const splitSearchTokens = (value: string): string[] =>
    value
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

  const matchesAllSearchTokens = (value: string, tokens: string[]): boolean => {
    if (!value || tokens.length < 2) return false;
    const normalized = value.toLowerCase();
    if (!normalized) return false;
    const words = normalized.split(/\s+/).filter(Boolean);

    return tokens.every((token) => {
      if (!token) return false;
      return words.some((word) => word.startsWith(token));
    });
  };

  const splitSearchWords = (value: string): string[] =>
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((word) => word.trim())
      .filter(Boolean);

  const isSubsequenceMatch = (query: string, target: string): boolean => {
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
  };

  const matchesWordPrefixSignature = (
    query: string,
    source: string
  ): boolean => {
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
  };

  const getItemCodeParts = (value: string) => {
    const trimmedValue = value.trim();
    const [base = "", suffix = ""] = trimmedValue.split(".");
    return { base, suffix };
  };

  const buildManualSearchResults = (
    query: string,
    mode: DataEntryMode,
    items: BrandItem[]
  ): SearchResult[] => {
    if (!query.trim() || mode === "scan") return [];
    const term = query.trim().toLowerCase();
    const searchTokens = splitSearchTokens(term);
    const hasMultipleTokens = searchTokens.length > 1;
    const scored: SearchResult[] = [];

    items.forEach((item) => {
      const brand = getBrandName(item).toLowerCase();
      const itemName = getItemName(item).toLowerCase();
      const barcode = getBarcodeValue(item).toLowerCase();
      const combinedName = `${brand} ${itemName}`.trim();
      const initials = combinedName ? getBrandInitials(combinedName) : "";
      const normalizedTerm = normalizeSearchText(term);
      const normalizedBrand = normalizeSearchText(brand);
      const normalizedItem = normalizeSearchText(itemName);
      const normalizedCombined = normalizeSearchText(combinedName);
      const brandTokensMatch = matchesAllSearchTokens(brand, searchTokens);
      const itemTokensMatch = matchesAllSearchTokens(itemName, searchTokens);
      const combinedTokensMatch = matchesAllSearchTokens(
        combinedName,
        searchTokens
      );
      let score = 0;
      let matchType: "exact" | "partial" | "abbreviation" = "partial";

      if (mode === "barcode") {
        const itemCodeValue = getItemCodeValue(item);
        if (!itemCodeValue) return;
        const normalizedCode = normalizeCodeValue(itemCodeValue);
        if (!normalizedCode) return;

        const { base: itemBase, suffix: itemSuffix } =
          getItemCodeParts(normalizedCode);
        const { base: termBase, suffix: termSuffix } = getItemCodeParts(term);
        const hasPackSpecifier = term.includes(".");

        if (hasPackSpecifier) {
          if (normalizedCode === term) {
            score = 140;
            matchType = "exact";
          } else if (
            itemBase === termBase &&
            termSuffix &&
            itemSuffix.startsWith(termSuffix)
          ) {
            score = 120 - Math.max(0, itemSuffix.length - termSuffix.length);
          } else if (normalizedCode.startsWith(term)) {
            score = 110;
          }
        } else {
          if (itemBase === term) {
            score = 130;
            matchType = "exact";
          } else if (normalizedCode.startsWith(`${term}.`)) {
            score = 115;
          } else if (itemBase.startsWith(term)) {
            score = 110 - Math.max(0, itemBase.length - term.length);
          } else if (normalizedCode.startsWith(term)) {
            score = 105;
          } else if (barcode && barcode.startsWith(term)) {
            // fallback for actual barcodes scanned into code field
            score = 80;
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
        } else if (
          hasMultipleTokens &&
          (brandTokensMatch || combinedTokensMatch || itemTokensMatch)
        ) {
          if (brandTokensMatch) {
            score = 92;
          } else if (combinedTokensMatch) {
            score = 90;
          } else {
            score = 88;
          }
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

      if (score > 0) {
        scored.push({
          ...item,
          matchScore: score,
          matchType,
        });
      }
    });

    return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, 40);
  };

  const groupManualSearchResults = (
    items: SearchResult[]
  ): ManualResultGroup[] => {
    const groupMap = new Map<string, ManualResultGroup>();

    items.forEach((item) => {
      const brandName = getBrandName(item) || "Unknown Brand";
      const itemName = getItemName(item);
      const key = `${brandName}|${itemName}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          brandName,
          itemName,
          packOptions: [],
          matchScore: item.matchScore,
          matchType: item.matchType,
        });
      }
      const group = groupMap.get(key)!;
      group.packOptions.push(item);
      if (item.matchScore > group.matchScore) {
        group.matchScore = item.matchScore;
        group.matchType = item.matchType;
      }
    });

    return Array.from(groupMap.values()).sort(
      (a, b) => b.matchScore - a.matchScore
    );
  };

  const handleEntryModeChange = (mode: DataEntryMode) => {
    setDataEntryMode(mode);
    setManualSearchQuery("");
    setManualResults([]);
    setSelectedItemFilter("all");
  };

  useEffect(() => {
    setManualSearchQuery("");
    setManualResults([]);
    setSelectedItemFilter("all");
  }, [dataEntryMode]);

  const handleManualSearchChange = (value: string) => {
    const sanitizedValue =
      dataEntryMode === "barcode" ? value.replace(/[^0-9.]/g, "") : value;
    setManualSearchQuery(sanitizedValue);
    setSelectedItemFilter("all");
    if (dataEntryMode === "scan") {
      setManualResults([]);
      return;
    }

    const trimmed = sanitizedValue.trim().toLowerCase();
    const minLength = dataEntryMode === "barcode" ? 1 : 2;
    if (trimmed.length < minLength) {
      setManualResults([]);
      return;
    }
    if (dataEntryMode === "barcode" && trimmed.includes(".")) {
      const exactMatch = brandItems.find(
        (item) => normalizeCodeValue(getItemCodeValue(item)) === trimmed
      );
      if (exactMatch) {
        setManualResults([]);
        setShowPackSizeModal(false);
        handleManualSelection(exactMatch);
        return;
      }
    }

    setManualResults(
      buildManualSearchResults(trimmed, dataEntryMode, brandItems)
    );
  };

  const handleManualSelection = (item: BrandItem) => {
    setManualSelection(item);
    setManualSelectionMode(dataEntryMode);
    setManualQuantity("1");
    setShowManualQuantityModal(true);
  };

  const handleManualGroupSelection = (group: ManualResultGroup) => {
    if (group.packOptions.length === 0) return;
    if (group.packOptions.length === 1) {
      setSelectedManualGroup(null);
      handleManualSelection(group.packOptions[0]);
      return;
    }
    setSelectedManualGroup(group);
    setShowPackSizeModal(true);
  };

  const closePackSizeModal = () => {
    setShowPackSizeModal(false);
    setSelectedManualGroup(null);
  };

  const handleManualPackSelection = (item: BrandItem) => {
    setShowPackSizeModal(false);
    setSelectedManualGroup(null);
    handleManualSelection(item);
  };

  const closeManualSelectionModal = () => {
    setShowManualQuantityModal(false);
    setManualSelection(null);
  };

  const addManualSelectionToList = () => {
    if (!manualSelection) return;
    const quantity = parseInt(manualQuantity, 10);
    if (Number.isNaN(quantity) || quantity <= 0) {
      showToastMessage("Enter a valid quantity");
      return;
    }

    const brandName = getBrandName(manualSelection);
    const itemName = getItemName(manualSelection);
    const pack = getPackValue(manualSelection);
    const barcodeValue = getBarcodeValue(manualSelection);
    const resolvedValue =
      barcodeValue && barcodeValue.trim().length > 0
        ? barcodeValue.trim()
        : `MANUAL-${brandName || itemName}-${pack}-${Date.now()}`;
    const mrpValue = parseFloat(getMrpValue(manualSelection) || "0") || 0;
    const formatLabel =
      manualSelectionMode === "barcode" ? "Manual-Code" : "Manual-Name";

    setScannedBarcodes((prev) => {
      const existingIndex = prev.findIndex(
        (barcode) => barcode.value === resolvedValue
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + quantity,
          timestamp: new Date(),
        };
        return updated;
      }

      return [
        ...prev,
        {
          id: Date.now().toString() + Math.random(),
          value: resolvedValue,
          format: formatLabel,
          timestamp: new Date(),
          quantity,
          productName: itemName || brandName || "Manual Entry",
          brandName: brandName || undefined,
          pack: pack || undefined,
          mrp: mrpValue,
          isMatched: true,
        },
      ];
    });

    showToastMessage(
      `${brandName || itemName || "Manual product"} added (${quantity})`
    );
    closeManualSelectionModal();
  };

  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  const [apiCallsStatus, setApiCallsStatus] = useState({
    printers: false,
    brands: false,
    addOns: false,
  });

  // Back button handler ref
  const backButtonListenerRef = useRef<any>(null);

  // Back button handler setup
  useEffect(() => {
    setupBackButtonHandler(handleBackButton, backButtonListenerRef);

    return () => {
      cleanupBackButtonHandler(backButtonListenerRef);
    };
  }, [
    showAddOnQuantityPopover,
    showQuantityPopover,
    showPrintModal,
    showAddOnModal,
    showSettingsModal,
    isScanning,
  ]);

  // Handle back button press based on current modal state
  const handleBackButton = () => {
    if (showAddOnQuantityPopover) {
      setShowAddOnQuantityPopover(false);
      return;
    }

    if (showQuantityPopover) {
      setShowQuantityPopover(false);
      return;
    }

    if (showPrintModal) {
      setShowPrintModal(false);
      return;
    }

    if (showAddOnModal) {
      setShowAddOnModal(false);
      return;
    }

    if (showSettingsModal) {
      setShowSettingsModal(false);
      return;
    }

    if (isScanning) {
      stopScanning();
      return;
    }

    setShowCompleteAlert(true);
  };

  useIonViewWillEnter(() => {
    checkPermissions();
    initializeSettings();
    loadLastBillNumber();
    loadAPIData();
  });

  useEffect(() => {
    if (dataEntryMode === "scan") return;
    const trimmed = manualSearchQuery.trim();
    const minLength = dataEntryMode === "barcode" ? 1 : 2;
    if (trimmed.length >= minLength && brandItems.length > 0) {
      setManualResults(
        buildManualSearchResults(trimmed, dataEntryMode, brandItems)
      );
    }
  }, [brandItems]);

  const allocatePrintCode = async () => {
    const apiBaseUrl = getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/code/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: "myapp",
        reason: "print",
      }),
    });
    const result = await response.json();
    if (!response.ok || !result?.success || !result?.code) {
      throw new Error(result?.message || "Failed to allocate code");
    }
    return String(result.code);
  };

  const releasePrintCode = async (code: string, reason: string) => {
    const apiBaseUrl = getApiBaseUrl();
    try {
      await fetch(`${apiBaseUrl}/code/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: "myapp",
          code,
          reason,
        }),
      });
    } catch (error) {
      console.error("Failed to release code:", error);
    }
  };

  // Initialize settings
  const initializeSettings = () => {
    const savedUrl = getApiBaseUrl();
    setCurrentApiUrl(savedUrl);
    setTempApiUrl(savedUrl);
  };

  const loadLastBillNumber = () => {
    const stored = localStorage.getItem(LAST_BILL_STORAGE_KEY) || "";
    setLastBillNumber(stored);
  };

  const persistLastBillNumber = (code: string) => {
    setLastBillNumber(code);
    localStorage.setItem(LAST_BILL_STORAGE_KEY, code);
  };

  // Load data from APIs
  const loadAPIData = async () => {
    let tempStatus = {
      printers: false,
      brands: false,
      addOns: false,
    };

    try {
      // Load printers
      try {
        const printerResponse = await getAllPrinters();
        setPrinters(printerResponse.data);
        tempStatus.printers = true;
      } catch (error) {
        console.error("Error loading printers:", error);
        tempStatus.printers = false;
      }

      // Load brand items
      try {
        const brandResponse = await getBrands();
        setBrandItems(brandResponse.data);
        tempStatus.brands = true;
      } catch (error) {
        console.error("Error loading brands:", error);
        tempStatus.brands = false;
      }

      // Load add-on items
      try {
        const addOnResponse = await getProducts();
        setAddOnItems(addOnResponse.data);
        tempStatus.addOns = true;
      } catch (error) {
        console.error("Error loading add-ons:", error);
        tempStatus.addOns = false;
      }

      setApiCallsStatus(tempStatus);

      const allConnected =
        tempStatus.printers && tempStatus.brands && tempStatus.addOns;
      setConnectionStatus(allConnected ? "connected" : "disconnected");

      if (!allConnected) {
        showToastMessage(
          "Some API connections failed - Check API URL in settings"
        );
      }
    } catch (error) {
      console.error("Error in loadAPIData:", error);
      setConnectionStatus("disconnected");
      setApiCallsStatus({ printers: false, brands: false, addOns: false });
      showToastMessage(
        "Error loading product data - Check API URL in settings"
      );
    }
  };

  // Settings functions
  const openSettings = () => {
    const savedUrl = getApiBaseUrl();
    setCurrentApiUrl(savedUrl);
    setTempApiUrl(savedUrl);
    setShowSettingsModal(true);
  };

  const saveSettings = () => {
    const trimmedUrl = tempApiUrl.trim();
    if (!trimmedUrl) {
      setApiBaseUrl(DEFAULT_API_BASE_URL);
      const savedUrl = getApiBaseUrl();
      setCurrentApiUrl(savedUrl);
      setTempApiUrl(savedUrl);
      showToastMessage("API URL reset to default");
      setShowSettingsModal(false);
      loadAPIData();
      return;
    }

    try {
      new URL(trimmedUrl);
    } catch (error) {
      showToastMessage("Please enter a valid URL");
      return;
    }

    setApiBaseUrl(trimmedUrl);
    const savedUrl = getApiBaseUrl();
    setCurrentApiUrl(savedUrl);
    setTempApiUrl(savedUrl);
    setShowSettingsModal(false);
    showToastMessage("Settings saved successfully");
    loadAPIData();
  };

  const resetToDefault = () => {
    setTempApiUrl(DEFAULT_API_BASE_URL);
  };

  // Cleanup scanner on component unmount
  useEffect(() => {
    return () => {
      if (isScanning) {
        stopScanning();
      }
      clearAllTimeouts();
    };
  }, []);

  const clearAllTimeouts = () => {
    if (scanCooldownRef.current) {
      clearTimeout(scanCooldownRef.current);
      scanCooldownRef.current = null;
    }
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }
  };

  const startCooldownTimer = () => {
    setCooldownTimeLeft(3);
    setCanScan(false);

    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownIntervalRef.current!);
          setCanScan(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const addBarcodeListener = async () => {
    const listener = await BarcodeScanner.addListener(
      "barcodesScanned",
      (event: BarcodesScannedEvent) => {
        console.log("Barcode scan event received:", event.barcodes);

        if (!canScan) {
          console.log("Scan blocked: Cooldown active");
          return;
        }

        const currentTime = Date.now();
        if (currentTime - lastScanTimeRef.current < 2000) {
          console.log("Scan blocked: Too soon after last scan");
          return;
        }

        lastScanTimeRef.current = currentTime;

        if (event.barcodes && event.barcodes.length > 0) {
          const barcode = event.barcodes[0];

          // Filter out QR codes - only process traditional barcodes
          const allowedFormats = [
            "CODE_128",
            "CODE_39",
            "CODE_93",
            "CODABAR",
            "EAN_13",
            "EAN_8",
            "UPC_A",
            "UPC_E",
            "ITF",
          ];

          if (!allowedFormats.includes(barcode.format)) {
            console.log(
              "Scan blocked: QR code or unsupported format detected:",
              barcode.format
            );
            return;
          }

          const barcodeValue = barcode.displayValue || barcode.rawValue || "";

          if (barcodeValue.trim()) {
            console.log("Processing barcode:", barcodeValue);
            processBarcodeResult(
              barcodeValue,
              barcode.format,
              brandItems,
              scannedBarcodes,
              quantityMode,
              setScannedBarcodes,
              setSelectedBarcodeId,
              setCustomQuantity,
              setShowQuantityPopover,
              showToastMessage
            );
            startCooldownTimer();
          }
        }
      }
    );

    return listener;
  };

  const removeBarcodeListener = async () => {
    await BarcodeScanner.removeAllListeners();
  };

  const startScanning = async () => {
    const permission = await checkPermissions();
    if (!permission) {
      showToastMessage("Camera permission is required to scan barcodes");
      return;
    }

    try {
      const isAvailable = await BarcodeScanner.isSupported();
      if (!isAvailable.supported) {
        showToastMessage("Barcode scanning not supported on this device");
        return;
      }

      if (Capacitor.getPlatform() === "android") {
        try {
          const moduleAvailable =
            await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
          if (!moduleAvailable.available) {
            await BarcodeScanner.installGoogleBarcodeScannerModule();
          }
        } catch (error) {
          console.error("Error checking/installing scanner module:", error);
          showToastMessage("Error preparing barcode scanner");
          return;
        }
      }

      setCanScan(true);
      setCooldownTimeLeft(0);
      lastScanTimeRef.current = 0;
      processedBarcodesRef.current.clear();
      clearAllTimeouts();

      document.querySelector("body")?.classList.add("barcode-scanner-active");
      await addBarcodeListener();
      await BarcodeScanner.startScan({ formats: [] });
      setIsScanning(true);
    } catch (error: any) {
      console.error("Scanning error:", error);
      await removeBarcodeListener();
      setIsScanning(false);
      document
        .querySelector("body")
        ?.classList.remove("barcode-scanner-active");
      clearAllTimeouts();

      if (
        error.message?.includes("cancelled") ||
        error.message?.includes("canceled")
      ) {
        showToastMessage("Scanning cancelled");
      } else {
        showToastMessage("Error starting barcode scanner");
      }
    }
  };

  const stopScanning = async () => {
    try {
      await BarcodeScanner.stopScan();
      await removeBarcodeListener();
      document
        .querySelector("body")
        ?.classList.remove("barcode-scanner-active");
      clearAllTimeouts();
      setCanScan(true);
      setCooldownTimeLeft(0);
      lastScanTimeRef.current = 0;
      processedBarcodesRef.current.clear();
      setIsScanning(false);
    } catch (error) {
      console.error("Error stopping scan:", error);
      showToastMessage("Error stopping scanner");
    }
  };

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeBarcode(id);
      return;
    }

    setScannedBarcodes((prev) =>
      prev.map((barcode) =>
        barcode.id === id ? { ...barcode, quantity: newQuantity } : barcode
      )
    );
  };

  const incrementQuantity = (id: string) => {
    const barcode = scannedBarcodes.find((b) => b.id === id);
    if (barcode) {
      updateQuantity(id, barcode.quantity + 1);
      showToastMessage(`Quantity: ${barcode.quantity + 1}`);
    }
  };

  const decrementQuantity = (id: string) => {
    const barcode = scannedBarcodes.find((b) => b.id === id);
    if (barcode && barcode.quantity > 1) {
      updateQuantity(id, barcode.quantity - 1);
      showToastMessage(`Quantity: ${barcode.quantity - 1}`);
    } else if (barcode && barcode.quantity === 1) {
      removeBarcode(id);
    }
  };

  const openQuantityPopover = (id: string) => {
    const barcode = scannedBarcodes.find((b) => b.id === id);
    if (barcode) {
      setSelectedBarcodeId(id);
      setCustomQuantity(barcode.quantity.toString());
      setShowQuantityPopover(true);
    }
  };

  const saveCustomQuantity = () => {
    const quantity = parseInt(customQuantity);
    if (isNaN(quantity) || quantity < 0) {
      showToastMessage("Please enter a valid quantity");
      return;
    }

    updateQuantity(selectedBarcodeId, quantity);
    setShowQuantityPopover(false);
    showToastMessage(`Quantity set to ${quantity}`);
  };

  // Add-on management functions
  const openAddOnQuantityPopover = (index: number) => {
    setSelectedAddOnIndex(index);
    setAddOnCustomQuantity(selectedAddOns[index]?.quantity?.toString() || "0");
    setShowAddOnQuantityPopover(true);
  };

  const saveAddOnCustomQuantity = () => {
    const quantity = parseInt(addOnCustomQuantity);
    if (isNaN(quantity) || quantity < 0) {
      showToastMessage("Please enter a valid quantity");
      return;
    }

    updateAddOnQuantity(
      selectedAddOnIndex,
      quantity,
      selectedAddOns,
      setSelectedAddOns
    );
    setShowAddOnQuantityPopover(false);
    showToastMessage(`Add-on quantity set to ${quantity}`);
  };

  const incrementAddOnQuantity = (index: number) => {
    const addOn = selectedAddOns[index];
    if (addOn) {
      updateAddOnQuantity(
        index,
        addOn.quantity + 1,
        selectedAddOns,
        setSelectedAddOns
      );
      showToastMessage(`${addOn.product} quantity: ${addOn.quantity + 1}`);
    }
  };

  const decrementAddOnQuantity = (index: number) => {
    const addOn = selectedAddOns[index];
    if (addOn && addOn.quantity > 1) {
      updateAddOnQuantity(
        index,
        addOn.quantity - 1,
        selectedAddOns,
        setSelectedAddOns
      );
      showToastMessage(`${addOn.product} quantity: ${addOn.quantity - 1}`);
    } else if (addOn && addOn.quantity === 1) {
      updateAddOnQuantity(index, 0, selectedAddOns, setSelectedAddOns);
      showToastMessage(`${addOn.product} removed`);
    }
  };

  const handleToggleAddOn = (item: AddOnItem) => {
    toggleAddOn(item, selectedAddOns, setSelectedAddOns);
  };

  const showToastMessage = (message: string, durationMs: number = 1500) => {
    setToastMessage(message);
    setToastDuration(durationMs);
    setShowToast(true);
  };

  const toggleBarcodeSelection = (id: string) => {
    const queueIds = scannedBarcodes.slice(0, 12).map((barcode) => barcode.id);
    if (!queueIds.includes(id)) {
      showToastMessage("Only the first 12 items can be selected");
      return;
    }

    setSelectedBarcodeIds((prevSelected) => {
      const isSelected = prevSelected.includes(id);
      if (isSelected) {
        setManuallyDeselectedIds((prevDeselected) =>
          prevDeselected.includes(id) ? prevDeselected : [...prevDeselected, id]
        );
        return prevSelected.filter((selectedId) => selectedId !== id);
      }

      setManuallyDeselectedIds((prevDeselected) =>
        prevDeselected.filter((deselectedId) => deselectedId !== id)
      );
      return [...prevSelected, id];
    });
  };

  const areIdArraysEqual = (a: string[], b: string[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  };

  const getSelectedBarcodes = (): EnhancedScannedBarcode[] => {
    const selectedSet = new Set(selectedBarcodeIds);
    return scannedBarcodes.filter((barcode) => selectedSet.has(barcode.id));
  };

  const syncSelectionState = useCallback(() => {
    const queueIds = scannedBarcodes.slice(0, 12).map((barcode) => barcode.id);
    const queueSet = new Set(queueIds);
    const nextDeselected = manuallyDeselectedIds.filter((id) =>
      queueSet.has(id)
    );
    const nextSelected = queueIds.filter((id) => !nextDeselected.includes(id));

    if (!areIdArraysEqual(nextSelected, selectedBarcodeIds)) {
      setSelectedBarcodeIds(nextSelected);
    }
    if (!areIdArraysEqual(nextDeselected, manuallyDeselectedIds)) {
      setManuallyDeselectedIds(nextDeselected);
    }
  }, [scannedBarcodes, selectedBarcodeIds, manuallyDeselectedIds]);

  const handlePrint = async () => {
    const selectedScanned = getSelectedBarcodes();
    if (selectedScanned.length === 0 && selectedAddOns.length === 0) {
      showToastMessage("No items to print!");
      return;
    }

    if (isScanning) {
      stopScanning();
    }

    if (selectedAddOns.length === 0) {
      const defaultAddOns = addOnItems.map((item) => ({
        itemCode: item["ITEM CODE"],
        product: item["PRODUCT"],
        price: parseFloat(item["PRICE"] || "0"),
        quantity: 0,
        totalPrice: 0,
      }));
      setSelectedAddOns(defaultAddOns);
    }

    setShowAddOnModal(true);
  };

  const proceedToPrinterSelection = () => {
    setShowAddOnModal(false);
    setShowPrintModal(true);
  };

  const clearAllItems = () => {
    setScannedBarcodes([]);
    processedBarcodesRef.current.clear();
    setSelectedAddOns([]);
    setSelectedBarcodeIds([]);
    setManuallyDeselectedIds([]);
  };

  const executePrint = async () => {
    if (!selectedPrinter) {
      showToastMessage("Please select a printer");
      return;
    }

    setIsPrinting(true);
    let allocatedCode = "";

    try {
      const selectedScanned = getSelectedBarcodes();
      if (selectedScanned.length === 0 && selectedAddOns.length === 0) {
        showToastMessage("No items selected to print!");
        return;
      }

      allocatedCode = await allocatePrintCode();

      const stats = getStatistics(selectedScanned, selectedAddOns);
      const printPayload = {
        uniqueCode: allocatedCode,
        scannedItems: selectedScanned.map((barcode) => ({
          value: barcode.value,
          format: barcode.format,
          quantity: barcode.quantity,
          timestamp: barcode.timestamp.toISOString(),
          isMatched: barcode.isMatched,
          brandName: barcode.brandName || null,
          pack: barcode.pack || null,
          productName: barcode.productName,
          mrp: barcode.mrp || 0,
        })),
        addOns: selectedAddOns.filter((addOn) => addOn.quantity > 0),
        totalValue: stats.totalValue,
        totalQuantity: stats.totalQuantity,
        addOnsTotal: stats.addOnsTotal,
      };

      const currentApiUrl = getApiBaseUrl();
      const printResponse = await fetch(
        `${currentApiUrl}/print/ip/${selectedPrinter}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(printPayload),
        }
      );

      const printResult = await printResponse.json();

      if (printResult.success) {
        showToastMessage(`Print successful! Code: ${allocatedCode}`, 3000);
        persistLastBillNumber(allocatedCode);
        setShowPrintModal(false);
        setSelectedPrinter("");
        const printedIds = new Set(selectedScanned.map((item) => item.id));
        setScannedBarcodes((prev) =>
          prev.filter((barcode) => !printedIds.has(barcode.id))
        );
        setSelectedAddOns([]);
      } else {
        showToastMessage(`Print failed: ${printResult.message}`);
        if (allocatedCode) {
          await releasePrintCode(allocatedCode, "print_failed");
        }
      }
    } catch (error) {
      console.error("Print error:", error);
      showToastMessage("Error sending print job - Check API URL in settings");
      if (allocatedCode) {
        await releasePrintCode(allocatedCode, "print_error");
      }
    } finally {
      setIsPrinting(false);
    }
  };

  const removeBarcode = (id: string) => {
    setScannedBarcodes((prev) => prev.filter((barcode) => barcode.id !== id));
    showToastMessage("Item removed");
  };

  const clearAllBarcodes = () => {
    setScannedBarcodes([]);
    processedBarcodesRef.current.clear();
    setSelectedBarcodeIds([]);
    setManuallyDeselectedIds([]);
    showToastMessage("All items cleared");
  };

  const stats = getStatistics(scannedBarcodes, selectedAddOns);
  const manualMinLength = dataEntryMode === "barcode" ? 1 : 2;
  const hasManualQuery = manualSearchQuery.trim().length >= manualMinLength;
  const itemFilterOptions = useMemo(() => {
    const options = manualResults
      .map((result) => (getItemName(result) || "").trim())
      .filter((name) => name.length > 0);
    return Array.from(new Set(options)).sort();
  }, [manualResults]);

  const filteredManualResults = useMemo(() => {
    if (selectedItemFilter === "all") {
      return manualResults;
    }
    return manualResults.filter(
      (result) => (getItemName(result) || "").trim() === selectedItemFilter
    );
  }, [manualResults, selectedItemFilter]);

  const groupedManualResults = useMemo(
    () => groupManualSearchResults(filteredManualResults),
    [filteredManualResults]
  );

  useEffect(() => {
    if (
      selectedItemFilter !== "all" &&
      !itemFilterOptions.includes(selectedItemFilter)
    ) {
      setSelectedItemFilter("all");
    }
  }, [itemFilterOptions, selectedItemFilter]);

  const handleRefresh = async (event: CustomEvent) => {
    try {
      await loadAPIData();
    } catch (error) {
      console.error("Error during refresh:", error);
    } finally {
      event.detail.complete();
    }
  };

  useEffect(() => {
    syncSelectionState();
  }, [syncSelectionState]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={openSettings}>
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  justifyContent: "space-between",
                }}
              >
                <span>Scanner</span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "bold",
                      backgroundColor:
                        connectionStatus === "connected"
                          ? "#2dd36f"
                          : "#eb445a",
                      color: "white",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      textAlign: "end",
                    }}
                  >
                    {connectionStatus === "connected"
                      ? "Connected"
                      : "Not Connected"}
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: "#f4f5f8",
                      color: "#1e2023",
                      textAlign: "end",
                    }}
                  >
                    Last bill number: {lastBillNumber || "N/A"}
                  </span>
                </div>
              </div>
            </IonTitle>
          <IonButtons slot="end">
            {(scannedBarcodes.length > 0 ||
              selectedAddOns.some((addOn) => addOn.quantity > 0)) && (
              <IonBadge color="primary">
                {scannedBarcodes.length +
                  selectedAddOns.filter((addOn) => addOn.quantity > 0)
                    .length}{" "}
                ({stats.totalQuantity})
              </IonBadge>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="scanner-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent
            pullingIcon={chevronDownCircleOutline}
            pullingText="Pull to refresh"
            refreshingSpinner="circles"
            refreshingText="Refreshing..."
          />
        </IonRefresher>

        <IonCard>
          <IonCardContent style={{ padding: "0" }}>
            <IonSegment
              value={dataEntryMode}
              onIonChange={(event) =>
                handleEntryModeChange(
                  (event.detail.value as DataEntryMode) || "scan"
                )
              }
            >
              <IonSegmentButton value="scan">
                <IonLabel>Scan</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="barcode">
                <IonLabel>Code</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="name">
                <IonLabel>Name</IonLabel>
              </IonSegmentButton>
            </IonSegment>

            {dataEntryMode === "scan" ? (
              <div className="manual-entry-placeholder"></div>
            ) : (
              <div className="manual-entry-form">
                <IonSearchbar
                  value={manualSearchQuery}
                  onIonInput={(event) =>
                    handleManualSearchChange(event.detail.value || "")
                  }
                  placeholder={
                    dataEntryMode === "barcode"
                      ? "Enter item code (e.g., 233.1)..."
                      : "Search by brand or item name..."
                  }
                  debounce={250}
                  type={dataEntryMode === "barcode" ? "text" : "search"}
                  inputmode={dataEntryMode === "barcode" ? "decimal" : "text"}
                  disabled={brandItems.length === 0}
                />
                {hasManualQuery && itemFilterOptions.length > 1 && (
                  <IonItem lines="none">
                    <IonLabel>Item</IonLabel>
                    <IonSelect
                      value={selectedItemFilter}
                      onIonChange={(event) =>
                        setSelectedItemFilter(event.detail.value || "all")
                      }
                      interface="popover"
                    >
                      <IonSelectOption value="all">All</IonSelectOption>
                      {itemFilterOptions.map((itemName) => (
                        <IonSelectOption key={itemName} value={itemName}>
                          {itemName}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                )}
                <div className="manual-entry-results">
                  {brandItems.length === 0 ? (
                    <IonNote color="danger">
                      Brand list not loaded yet. Pull to refresh after setting
                      the API URL.
                    </IonNote>
                  ) : !hasManualQuery ? (
                    <IonNote color="medium"></IonNote>
                  ) : groupedManualResults.length === 0 ? (
                    <IonNote color="warning">No matches found.</IonNote>
                  ) : (
                    <div
                      className="manual-entry-results-list"
                      style={{ maxHeight: "260px", overflowY: "auto" }}
                    >
                      <IonList lines="full">
                        {groupedManualResults.map((group, index) => (
                          <IonItem
                            key={`${group.brandName}-${group.itemName}-${index}`}
                            button
                            detail
                            onClick={() => handleManualGroupSelection(group)}
                          >
                            <IonLabel>
                              <h3>{group.brandName || "Unknown Brand"}</h3>
                              {group.itemName && <p>{group.itemName}</p>}
                            </IonLabel>
                          </IonItem>
                        ))}
                      </IonList>
                    </div>
                  )}
                </div>
              </div>
            )}
          </IonCardContent>
        </IonCard>

        <IonModal
          isOpen={showPackSizeModal}
          onDidDismiss={closePackSizeModal}
          className="manual-pack-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Select Pack Size</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={closePackSizeModal}>Close</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            {selectedManualGroup && (
              <>
                <div style={{ padding: "16px" }}>
                  <h2 style={{ marginBottom: "4px" }}>
                    {selectedManualGroup.brandName}
                  </h2>
                  {selectedManualGroup.itemName && (
                    <p
                      style={{
                        margin: 0,
                        color: "var(--ion-color-medium)",
                        fontSize: "14px",
                      }}
                    >
                      {selectedManualGroup.itemName}
                    </p>
                  )}
                </div>
                <IonList>
                  {selectedManualGroup.packOptions.map((packItem, index) => {
                    const packLabel = getPackValue(packItem);
                    const bpc = getFieldValue(packItem, ["BPC"]);
                    const mrp = getMrpValue(packItem);
                    return (
                      <IonItem
                        key={`${selectedManualGroup.brandName}-${packLabel}-${index}`}
                        button
                        detail
                        onClick={() => handleManualPackSelection(packItem)}
                      >
                        <IonLabel>
                          <h3 style={{ marginBottom: "4px" }}>
                            {packLabel
                              ? `${packLabel}ml`
                              : "Pack size unavailable"}
                          </h3>
                          <p style={{ margin: 0, fontSize: "14px" }}>
                            {bpc ? `BPC: ${bpc}` : "BPC: -"}
                            {mrp ? ` • MRP: ₹${mrp}` : ""}
                          </p>
                        </IonLabel>
                      </IonItem>
                    );
                  })}
                </IonList>
              </>
            )}
          </IonContent>
        </IonModal>

        <ScannerControls
          scannedBarcodes={scannedBarcodes}
          selectedAddOns={selectedAddOns}
          stats={stats}
          isScanning={isScanning}
          onStartScanning={startScanning}
          onStopScanning={stopScanning}
          onPrint={handlePrint}
          isPrinting={isPrinting}
          showScanButton={dataEntryMode === "scan"}
        />
        <ScannedItemsList
          scannedBarcodes={scannedBarcodes}
          isScanning={isScanning}
          onIncrementQuantity={incrementQuantity}
          onDecrementQuantity={decrementQuantity}
          onOpenQuantityPopover={openQuantityPopover}
          onRemoveBarcode={removeBarcode}
          onClearAllBarcodes={clearAllBarcodes}
          selectedIds={selectedBarcodeIds}
          onToggleSelected={toggleBarcodeSelection}
        />
        <AddOnsList
          selectedAddOns={selectedAddOns}
          isScanning={isScanning}
          onIncrementAddOnQuantity={incrementAddOnQuantity}
          onDecrementAddOnQuantity={decrementAddOnQuantity}
          onOpenAddOnQuantityPopover={openAddOnQuantityPopover}
          onRemoveAddOn={(index) =>
            updateAddOnQuantity(index, 0, selectedAddOns, setSelectedAddOns)
          }
        />
        <SettingsModal
          isOpen={showSettingsModal}
          onDismiss={() => setShowSettingsModal(false)}
          tempApiUrl={tempApiUrl}
          currentApiUrl={currentApiUrl}
          onTempApiUrlChange={setTempApiUrl}
          onResetToDefault={resetToDefault}
          onSaveSettings={saveSettings}
        />
        <AddOnModal
          isOpen={showAddOnModal}
          onDismiss={() => setShowAddOnModal(false)}
          addOnItems={addOnItems}
          selectedAddOns={selectedAddOns}
          onToggleAddOn={handleToggleAddOn}
          onIncrementAddOnQuantity={incrementAddOnQuantity}
          onDecrementAddOnQuantity={decrementAddOnQuantity}
          onOpenAddOnQuantityPopover={openAddOnQuantityPopover}
          onProceedToPrinterSelection={proceedToPrinterSelection}
          getAddOnsTotal={() =>
            getStatistics(scannedBarcodes, selectedAddOns).addOnsTotal
          }
        />
        <PrintModal
          isOpen={showPrintModal}
          onDismiss={() => setShowPrintModal(false)}
          scannedBarcodes={scannedBarcodes}
          selectedAddOns={selectedAddOns}
          printers={printers}
          selectedPrinter={selectedPrinter}
          onSelectedPrinterChange={setSelectedPrinter}
          onExecutePrint={executePrint}
          isPrinting={isPrinting}
          stats={stats}
        />
        <QuantityModal
          isOpen={showQuantityPopover}
          onDismiss={() => setShowQuantityPopover(false)}
          customQuantity={customQuantity}
          setCustomQuantity={setCustomQuantity}
          onSave={saveCustomQuantity}
          title="Set Item Quantity"
        />
        <QuantityModal
          isOpen={showManualQuantityModal}
          onDismiss={closeManualSelectionModal}
          customQuantity={manualQuantity}
          setCustomQuantity={setManualQuantity}
          onSave={addManualSelectionToList}
          title={
            manualSelection
              ? `Set quantity for ${
                  getBrandName(manualSelection) || "Manual Entry"
                }${
                  getPackValue(manualSelection)
                    ? ` (${getPackValue(manualSelection)}ml)`
                    : ""
                }`
              : "Set Quantity"
          }
        />
        <AddOnQuantityModal
          isOpen={showAddOnQuantityPopover}
          onDismiss={() => setShowAddOnQuantityPopover(false)}
          customQuantity={addOnCustomQuantity}
          setCustomQuantity={setAddOnCustomQuantity}
          onSave={saveAddOnCustomQuantity}
        />
        <IonAlert
          isOpen={showCompleteAlert}
          onDidDismiss={() => setShowCompleteAlert(false)}
          header="Exit App"
          message="Do you want to exit the app?"
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => {
                setShowCompleteAlert(false);
              },
            },
            {
              text: "Exit",
              handler: () => {
                App.exitApp();
              },
            },
          ]}
        />
        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMessage}
          duration={toastDuration}
          position="top"
          className={isScanning ? "scanning-toast" : ""}
        />
      </IonContent>
    </IonPage>
  );
};

export default BarcodeScannerPage;
