export type DashboardMetrics = {
  scannedCount: number;
  trackedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  uncheckedCount: number;
  mismatchCount: number;
  totalDiffBottles: number;
  totalDiffValue: number;
  totalDiffValueFormatted: string;
  locationCount: number;
  operatorCount: number;
};

export type DashboardCycle = {
  id: number;
  sno: number | null;
  status: string;
  startDate: string;
  endDate?: string | null;
  cycleDate: string;
  currentCycle: boolean;
};

export type MergedLocationSummary = {
  shopLocationId: number | null;
  shopLocationCode: string;
  shopLocationName: string;
  shopLocationLabel: string;
  cycle: DashboardMetrics | null;
  today: DashboardMetrics | null;
};

export type CentralDashboardShop = {
  id: number;
  registryName: string;
  baseUrl: string;
  active: boolean;
  status: "online" | "offline";
  shopName: string;
  cycle: DashboardCycle | null;
  cycleSummary: DashboardMetrics | null;
  today: {
    activityDate: string | null;
    operatorCount: number;
    summary: DashboardMetrics | null;
  } | null;
  locations: MergedLocationSummary[];
  error?: string;
};

export type CentralDashboardResponse = {
  success: boolean;
  generatedAt: string;
  summary: {
    shopCount: number;
    onlineShopCount: number;
    offlineShopCount: number;
    cycle: DashboardMetrics;
    today: DashboardMetrics & {
      activityDate: string | null;
    };
  };
  shops: CentralDashboardShop[];
};

export type CentralShopEndpoint = {
  id: number;
  shopName: string;
  baseUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Worker = {
  id: number;
  name: string;
  fatherName?: string | null;
  designationId?: number | null;
  designationName?: string | null;
  dateOfBirth?: string | null;
  dateOfJoining?: string | null;
  dateOfResignation?: string | null;
  permanentAddress?: string | null;
  temporaryAddress?: string | null;
  aadhaarNumber?: string | null;
  email?: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  recommendedBy?: string | null;
  workLocationId?: number | null;
  workLocationName?: string | null;
  profileImageBase64?: string | null;
  profileImageMimeType?: string | null;
  profileImageFileName?: string | null;
  resumeFileBase64?: string | null;
  resumeFileMimeType?: string | null;
  resumeFileName?: string | null;
  aadhaarImageBase64?: string | null;
  aadhaarImageMimeType?: string | null;
  aadhaarImageFileName?: string | null;
  phone?: string | null;
  phoneNumbers?: Array<{
    id?: number;
    label?: string | null;
    phoneNumber: string;
    isPrimary: boolean;
  }>;
  documents?: Array<{
    id?: number;
    category: string;
    label?: string | null;
    textValue?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileDataBase64?: string | null;
    sortOrder?: number;
    active?: boolean;
  }>;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkerPayload = {
  name: string;
  fatherName: string;
  designationName: string;
  dateOfBirth: string;
  dateOfJoining: string;
  dateOfResignation?: string | null;
  permanentAddress: string;
  temporaryAddress?: string | null;
  aadhaarNumber: string;
  email?: string | null;
  bankAccountNumber: string;
  ifscCode: string;
  recommendedBy: string;
  workLocationName?: string | null;
  profileImageBase64: string;
  profileImageMimeType?: string | null;
  profileImageFileName?: string | null;
  resumeFileBase64: string;
  resumeFileMimeType?: string | null;
  resumeFileName?: string | null;
  aadhaarImageBase64: string;
  aadhaarImageMimeType?: string | null;
  aadhaarImageFileName?: string | null;
  phoneNumbers: Array<{
    label?: string | null;
    phoneNumber: string;
    isPrimary: boolean;
  }>;
  documents?: Array<{
    category: string;
    label?: string | null;
    textValue?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileDataBase64?: string | null;
    sortOrder?: number;
    active?: boolean;
  }>;
  active?: boolean;
};

export type BestSellingProduct = {
  id: number;
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  active?: boolean;
};

export type MasterProduct = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
};

export type CentralReverseSyncSettings = {
  reverseSyncOperatorsEnabled: boolean;
  reverseSyncBestSellingEnabled: boolean;
};

export type StockOverviewMismatchRow = {
  id: number | null;
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  name: string;
  bpc: number;
  mrp: number | null;
  shopLocationId: number | null;
  shopLocationName: string;
  enteredBottles: number;
  currentStockBottles: number;
  diffBottles: number;
  diffFormatted: string;
  priceDiff: number;
  priceDiffFormatted: string;
  updatedAt: string | null;
  operatorId: number | null;
};

export type StockOverviewUncheckedRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  name: string;
  bpc: number | null;
  mrp: number | null;
  shopLocationId: number;
  shopLocationName: string;
};

export type StockOverviewMatchedRow = {
  itemCode: string;
  name: string;
};

export type StockOverviewLocation = {
  shopLocationId: number;
  shopLocationCode: string;
  shopLocationName: string;
  shopLocationLabel: string;
  scannedCount: number;
  trackedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  uncheckedCount: number;
  mismatchCount: number;
  operatorCount: number;
  totalDiffBottles: number;
  totalDiffValue: number;
  totalDiffValueFormatted: string;
  positiveDiffValue: number;
  negativeDiffValue: number;
  matchedRows: StockOverviewMatchedRow[];
  unmatchedRows: StockOverviewMismatchRow[];
  uncheckedRows: StockOverviewUncheckedRow[];
  mismatchRows: StockOverviewMismatchRow[];
};

export type StockOverviewResponse = {
  success: boolean;
  shopName: string;
  operatorCount: number;
  cycle: DashboardCycle;
  summary: DashboardMetrics;
  today?: {
    activityDate: string;
    operatorCount: number;
    summary: DashboardMetrics;
    locations: StockOverviewLocation[];
  };
  locations: StockOverviewLocation[];
};

export type StockOverviewOperator = {
  shopLocationId: number;
  shopLocationName: string;
  shopLocationLabel: string;
  operatorId: number;
  operatorName: string;
  scannedCount: number;
  matchedCount: number;
  mismatchCount: number;
  totalDiffBottles: number;
  totalDiffValue: number;
  totalDiffValueFormatted: string;
  rows: StockOverviewMismatchRow[];
};

export type StockActivityLogRow = {
  id: number;
  activityDate: string;
  eventTime: string | null;
  eventTimeLabel: string;
  shopLocationId: number;
  shopLocationName: string;
  shopLocationLabel: string;
  operatorId: number | null;
  operatorName: string;
  phoneId: number | null;
  phoneName: string;
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  name: string;
  eventScope: string;
  eventAction: string;
  matched: boolean | null;
  stockBottlesAfter: number;
  currentStockBottles: number;
  diffBottles: number;
  diffFormatted: string;
  mrp: number | null;
  priceDiff: number;
  priceDiffFormatted: string;
  changeSummary: string;
};

export type StockActivityLogResponse = {
  success: boolean;
  cycle: DashboardCycle;
  summary: {
    locationCount: number;
    logCount: number;
    operatorsTouched: number;
    matchedCount: number;
    mismatchCount: number;
    totalDiffBottles: number;
    totalDiffValue: number;
    totalDiffValueFormatted: string;
  };
  locations: Array<{
    shopLocationId: number;
    shopLocationName: string;
    shopLocationLabel: string;
    logCount: number;
    operatorsTouched: number;
    matchedCount: number;
    mismatchCount: number;
    totalDiffBottles: number;
    totalDiffValue: number;
    totalDiffValueFormatted: string;
    logs: StockActivityLogRow[];
  }>;
};

export type StockOperatorOverviewResponse = {
  success: boolean;
  cycle: DashboardCycle;
  summary: {
    locationCount: number;
    operatorCount: number;
    scannedCount: number;
    matchedCount: number;
    mismatchCount: number;
    totalDiffBottles: number;
    totalDiffValue: number;
    totalDiffValueFormatted: string;
  };
  locations: Array<{
    shopLocationId: number;
    shopLocationName: string;
    shopLocationLabel: string;
    operators: StockOverviewOperator[];
  }>;
};

export type CentralDashboardShopDetailResponse = {
  success: boolean;
  generatedAt: string;
  shop: {
    id: number;
    registryName: string;
    shopName: string;
    baseUrl: string;
    active: boolean;
  };
  status: "online" | "offline";
  overview?: StockOverviewResponse;
  operatorOverview?: StockOperatorOverviewResponse;
  activityLogs?: StockActivityLogResponse;
  message?: string;
};
