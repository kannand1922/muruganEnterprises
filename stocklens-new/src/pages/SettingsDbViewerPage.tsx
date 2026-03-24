import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle, getAllCycles, type CycleSummary } from "../api/cyclesApi";
import {
  clearDbViewerRows,
  getDbViewerRows,
  getDbViewerTables,
  type DbViewerQueryResponse,
  type DbViewerTableKey,
  type DbViewerTableMeta,
} from "../api/dbViewerApi";
import { getShopLocations, type ShopLocation } from "../api/metaApi";
import { AppTopBar } from "../components/common/AppTopBar";
import { getCurrentLocationIdFromStorage } from "../config/location";

type MatchState = "all" | "matched" | "unmatched";

type TableDataState = {
  loading: boolean;
  errorText: string;
  rows: Record<string, unknown>[];
  totalCount: number;
  filteredCount: number;
};

const PRIMARY_TABLES: DbViewerTableKey[] = ["cycleFinishedStock", "cycleUnfinishedStock"];
const SECONDARY_LIMIT = 40;

const TABLE_COLUMN_PREFERENCES: Partial<Record<DbViewerTableKey, string[]>> = {
  cycleFinishedStock: [
    "id",
    "cycleId",
    "shopLocationId",
    "itemCode",
    "brandName",
    "itemName",
    "packValue",
    "quantityBottles",
    "currentStockBottles",
    "diffBottles",
    "isMatched",
    "phoneName",
    "activityDate",
    "finishedAt",
    "updatedAt",
  ],
  cycleUnfinishedStock: [
    "id",
    "cycleId",
    "shopLocationId",
    "itemCode",
    "brandName",
    "itemName",
    "packValue",
    "quantityBottles",
    "currentStockBottles",
    "diffBottles",
    "isMatched",
    "recheckShown",
    "phoneName",
    "activityDate",
    "updatedAt",
  ],
  cycleProductEvent: [
    "id",
    "cycleId",
    "shopLocationId",
    "itemCode",
    "eventScope",
    "eventAction",
    "matched",
    "stockBottlesAfter",
    "currentStockBottles",
    "diffBottles",
    "activityDate",
    "eventTime",
  ],
  diffBatch: ["id", "cycleId", "shopLocationId", "itemCount", "proofImageName", "createdAt", "deletedAt"],
  diffItem: [
    "id",
    "diffBatchId",
    "cycleId",
    "shopLocationId",
    "itemCode",
    "brandName",
    "itemName",
    "packValue",
    "diffBottles",
    "isMatched",
    "sourceScope",
    "updatedAt",
  ],
  cycle: ["id", "sno", "status", "startDate", "endDate", "updatedAt"],
};

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function looksLikeDateKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized.endsWith("at") || normalized.includes("date");
}

function getCycleLabel(cycle: CycleSummary | null | undefined) {
  if (!cycle) return "No cycle";
  const base = cycle.sno ? `Cycle #${cycle.sno}` : `Cycle ${cycle.id}`;
  return `${base} • ${new Date(cycle.startDate).toLocaleDateString("en-IN")}`;
}

function toSelectString(value: number | null) {
  return value ? String(value) : "all";
}

function parseSelectNumber(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function buildColumns(tableKey: DbViewerTableKey, rows: Record<string, unknown>[]) {
  const preferred = TABLE_COLUMN_PREFERENCES[tableKey] || [];
  const discovered = new Set<string>();
  const ordered: string[] = [];

  preferred.forEach((column) => {
    if (!discovered.has(column)) {
      discovered.add(column);
      ordered.push(column);
    }
  });

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!discovered.has(key)) {
        discovered.add(key);
        ordered.push(key);
      }
    });
  });

  return ordered;
}

function formatCellValue(
  column: string,
  value: unknown,
  cycleById: Map<number, CycleSummary>,
  locationById: Map<number, ShopLocation>
) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (column === "cycleId" && typeof value === "number") {
    const cycle = cycleById.get(value);
    return cycle ? getCycleLabel(cycle) : String(value);
  }
  if (column === "shopLocationId" && typeof value === "number") {
    return locationById.get(value)?.locationName || String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return looksLikeDateKey(column) ? formatDateTime(value) : value;
  }
  return JSON.stringify(value);
}

function emptyTableState(): TableDataState {
  return {
    loading: false,
    errorText: "",
    rows: [],
    totalCount: 0,
    filteredCount: 0,
  };
}

function mapResponseToState(response: DbViewerQueryResponse): TableDataState {
  return {
    loading: false,
    errorText: "",
    rows: response.rows,
    totalCount: response.totalCount,
    filteredCount: response.filteredCount,
  };
}

function DbResultsTable(props: {
  tableKey: DbViewerTableKey;
  rows: Record<string, unknown>[];
  loading: boolean;
  errorText: string;
  emptyLabel: string;
  cycleById: Map<number, CycleSummary>;
  locationById: Map<number, ShopLocation>;
}) {
  const columns = useMemo(() => buildColumns(props.tableKey, props.rows), [props.tableKey, props.rows]);

  if (props.loading) {
    return (
      <div className="db-viewer-loading">
        <IonSpinner name="crescent" />
        <IonText>Loading rows...</IonText>
      </div>
    );
  }

  if (props.errorText) {
    return <div className="operator-required-box">{props.errorText}</div>;
  }

  if (props.rows.length === 0) {
    return <div className="stock-empty">{props.emptyLabel}</div>;
  }

  return (
    <div className="db-viewer-table-wrap">
      <table className="db-viewer-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={String(row.id || `${props.tableKey}_${index}`)}>
              {columns.map((column) => {
                const rawValue = row[column];
                const formattedValue = formatCellValue(column, rawValue, props.cycleById, props.locationById);
                return (
                  <td key={`${String(row.id || index)}_${column}`} title={String(formattedValue)}>
                    {formattedValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsDbViewerPage() {
  const [presentToast] = useIonToast();

  const [metaLoading, setMetaLoading] = useState(false);
  const [tables, setTables] = useState<DbViewerTableMeta[]>([]);
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [currentCycle, setCurrentCycle] = useState<CycleSummary | null>(null);
  const [selectedTable, setSelectedTable] = useState<DbViewerTableKey>("cycleFinishedStock");
  const [selectedClearTable, setSelectedClearTable] = useState<DbViewerTableKey>("cycleFinishedStock");
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [matchState, setMatchState] = useState<MatchState>("all");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [rowLimit, setRowLimit] = useState<number>(100);
  const [mainTableState, setMainTableState] = useState<TableDataState>(emptyTableState());
  const [openSecondaryTables, setOpenSecondaryTables] = useState<string[]>([]);
  const [secondaryStates, setSecondaryStates] = useState<Partial<Record<DbViewerTableKey, TableDataState>>>({});
  const [clearPassword, setClearPassword] = useState("");
  const [clearingRows, setClearingRows] = useState(false);

  const tableByKey = useMemo(
    () => new Map<DbViewerTableKey, DbViewerTableMeta>(tables.map((row) => [row.key, row])),
    [tables]
  );
  const cycleById = useMemo(
    () => new Map<number, CycleSummary>(cycles.map((row) => [row.id, row])),
    [cycles]
  );
  const locationById = useMemo(
    () => new Map<number, ShopLocation>(locations.map((row) => [row.id, row])),
    [locations]
  );

  const currentTableMeta = tableByKey.get(selectedTable) || null;
  const currentClearTableMeta = tableByKey.get(selectedClearTable) || null;
  const currentLocation = selectedLocationId ? locationById.get(selectedLocationId) || null : null;
  const currentCycleLabel = getCycleLabel(cycleById.get(selectedCycleId || 0) || currentCycle);

  const secondaryTables = useMemo(() => {
    const knownTables = tables.filter((table) => !PRIMARY_TABLES.includes(table.key));
    const preferredOrder: DbViewerTableKey[] = [
      "cycleProductEvent",
      "diffBatch",
      "diffItem",
      "cycle",
      "operatorDailyMismatchSummary",
      "bestSellingProduct",
      "shopLocation",
      "worker",
      "device",
      "phone",
      "printer",
      "appSetting",
      "shopInfo",
      "lowStockLocationConfig",
      "lowStockPackRule",
      "lowStockBrandRule",
      "lowStockProductRule",
      "lowStockNotificationRun",
      "lowStockProductNotificationState",
      "nilStockLocationConfig",
      "nilStockNotificationRun",
      "nilStockProductNotificationState",
      "fcmDeviceToken",
    ];
    const orderIndex = new Map<DbViewerTableKey, number>(preferredOrder.map((key, index) => [key, index]));
    return [...knownTables].sort(
      (a, b) => (orderIndex.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.key) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [tables]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  async function loadMeta() {
    setMetaLoading(true);
    try {
      const [tableRows, cycleRows, activeCycleResult, locationRows] = await Promise.all([
        getDbViewerTables(),
        getAllCycles(),
        getCurrentCycle(),
        getShopLocations(),
      ]);

      setTables(tableRows);
      setSelectedClearTable((current) => {
        if (tableRows.some((row) => row.key === current)) return current;
        return "cycleFinishedStock";
      });
      setCycles(cycleRows);
      setCurrentCycle(activeCycleResult.cycle || null);
      setLocations(locationRows);

      const defaultCycleId = activeCycleResult.cycle?.id || cycleRows[0]?.id || null;
      const storedLocationId = getCurrentLocationIdFromStorage();
      const validStoredLocationId =
        storedLocationId && locationRows.some((row) => row.id === storedLocationId) ? storedLocationId : null;

      setSelectedCycleId((current) => {
        if (current && cycleRows.some((row) => row.id === current)) return current;
        return defaultCycleId;
      });
      setSelectedLocationId((current) => {
        if (current && locationRows.some((row) => row.id === current)) return current;
        return validStoredLocationId || locationRows[0]?.id || null;
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load DB viewer setup",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setMetaLoading(false);
    }
  }

  function buildQuery(tableKey: DbViewerTableKey, limit: number) {
    const meta = tableByKey.get(tableKey);
    return {
      table: tableKey,
      cycleId: meta?.supportsCycleFilter ? selectedCycleId : null,
      shopLocationId: meta?.supportsLocationFilter ? selectedLocationId : null,
      search: debouncedSearchText,
      matchState: meta?.supportsMatchFilter ? matchState : "all",
      limit,
    } as const;
  }

  async function loadMainTable() {
    const meta = tableByKey.get(selectedTable);
    if (!meta) return;
    if (meta.supportsCycleFilter && !selectedCycleId) return;

    setMainTableState((current) => ({ ...current, loading: true, errorText: "" }));
    try {
      const response = await getDbViewerRows(buildQuery(selectedTable, rowLimit));
      setMainTableState(mapResponseToState(response));
    } catch (error) {
      setMainTableState({
        loading: false,
        errorText: error instanceof Error ? error.message : "Failed to load rows",
        rows: [],
        totalCount: 0,
        filteredCount: 0,
      });
    }
  }

  async function loadSecondaryTable(tableKey: DbViewerTableKey) {
    const meta = tableByKey.get(tableKey);
    if (!meta) return;
    if (meta.supportsCycleFilter && !selectedCycleId) return;

    setSecondaryStates((current) => ({
      ...current,
      [tableKey]: {
        ...(current[tableKey] || emptyTableState()),
        loading: true,
        errorText: "",
      },
    }));

    try {
      const response = await getDbViewerRows(buildQuery(tableKey, SECONDARY_LIMIT));
      setSecondaryStates((current) => ({
        ...current,
        [tableKey]: mapResponseToState(response),
      }));
    } catch (error) {
      setSecondaryStates((current) => ({
        ...current,
        [tableKey]: {
          loading: false,
          errorText: error instanceof Error ? error.message : "Failed to load preview",
          rows: [],
          totalCount: 0,
          filteredCount: 0,
        },
      }));
    }
  }

  useEffect(() => {
    void loadMeta();
  }, []);

  useEffect(() => {
    void loadMainTable();
  }, [selectedTable, selectedCycleId, selectedLocationId, matchState, debouncedSearchText, rowLimit, tables]);

  useEffect(() => {
    if (openSecondaryTables.length === 0) return;
    openSecondaryTables.forEach((tableKey) => {
      const typedKey = tableKey as DbViewerTableKey;
      void loadSecondaryTable(typedKey);
    });
  }, [openSecondaryTables, selectedCycleId, selectedLocationId, matchState, debouncedSearchText, tables]);

  async function handleClearRows() {
    if (!currentClearTableMeta) {
      presentToast({
        message: "Select a table first",
        color: "warning",
        duration: 1600,
      });
      return;
    }

    if (currentClearTableMeta.supportsCycleFilter && !selectedCycleId) {
      presentToast({
        message: "Select a cycle for this table",
        color: "warning",
        duration: 1600,
      });
      return;
    }

    const password = clearPassword.trim();
    if (!password) {
      presentToast({
        message: "Password is required",
        color: "warning",
        duration: 1600,
      });
      return;
    }

    setClearingRows(true);
    try {
      const result = await clearDbViewerRows({
        table: selectedClearTable,
        cycleId: currentClearTableMeta.supportsCycleFilter ? selectedCycleId : null,
        shopLocationId: currentClearTableMeta.supportsLocationFilter ? selectedLocationId : null,
        password,
      });
      setClearPassword("");
      presentToast({
        message: `Cleared ${result.deletedCount} row(s) from ${currentClearTableMeta.label}`,
        color: "success",
        duration: 2000,
      });
      await loadMainTable();
      openSecondaryTables.forEach((tableKey) => {
        void loadSecondaryTable(tableKey as DbViewerTableKey);
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to clear rows",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setClearingRows(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar title="DB Viewer" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding db-viewer-page">
        <IonCard className="settings-config-card db-viewer-hero-card">
          <IonCardHeader>
            <IonCardTitle>DB Viewer</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="db-viewer-hero-grid">
              <div className="db-viewer-hero-stat">
                <span className="db-viewer-hero-label">Default Cycle</span>
                <strong>{currentCycleLabel}</strong>
              </div>
              <div className="db-viewer-hero-stat">
                <span className="db-viewer-hero-label">Location Filter</span>
                <strong>{currentLocation?.locationName || "All locations"}</strong>
              </div>
              <div className="db-viewer-hero-stat">
                <span className="db-viewer-hero-label">Mode</span>
                <strong>{currentTableMeta?.label || "Loading..."}</strong>
              </div>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Primary Tables</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonSegment
              value={selectedTable}
              onIonChange={(event) => {
                const value = String(event.detail.value || "cycleFinishedStock") as DbViewerTableKey;
                setSelectedTable(value);
              }}
              className="db-viewer-segment"
            >
              <IonSegmentButton value="cycleFinishedStock">
                <IonLabel>Finished</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="cycleUnfinishedStock">
                <IonLabel>Unfinished</IonLabel>
              </IonSegmentButton>
            </IonSegment>

            <div className="db-viewer-filter-grid">
              <IonItem lines="none" className="settings-select-row">
                <IonLabel position="stacked">Cycle</IonLabel>
                <IonSelect
                  value={toSelectString(selectedCycleId)}
                  interface="popover"
                  onIonChange={(event) => setSelectedCycleId(parseSelectNumber(event.detail.value))}
                >
                  {cycles.map((cycle) => (
                    <IonSelectOption key={cycle.id} value={String(cycle.id)}>
                      {getCycleLabel(cycle)}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              <IonItem lines="none" className="settings-select-row">
                <IonLabel position="stacked">Location</IonLabel>
                <IonSelect
                  value={toSelectString(selectedLocationId)}
                  interface="popover"
                  onIonChange={(event) => setSelectedLocationId(parseSelectNumber(event.detail.value))}
                >
                  <IonSelectOption value="all">All locations</IonSelectOption>
                  {locations.map((location) => (
                    <IonSelectOption key={location.id} value={String(location.id)}>
                      {location.locationName}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              <IonItem lines="none" className="settings-select-row">
                <IonLabel position="stacked">Match Filter</IonLabel>
                <IonSelect
                  value={matchState}
                  interface="popover"
                  onIonChange={(event) => setMatchState((String(event.detail.value || "all") as MatchState) || "all")}
                >
                  <IonSelectOption value="all">All rows</IonSelectOption>
                  <IonSelectOption value="matched">Matched only</IonSelectOption>
                  <IonSelectOption value="unmatched">Unmatched only</IonSelectOption>
                </IonSelect>
              </IonItem>

              <IonItem lines="none" className="settings-select-row">
                <IonLabel position="stacked">Row Limit</IonLabel>
                <IonSelect
                  value={String(rowLimit)}
                  interface="popover"
                  onIonChange={(event) => {
                    const parsed = parseSelectNumber(event.detail.value);
                    setRowLimit(parsed || 100);
                  }}
                >
                  {[50, 100, 200, 300].map((limit) => (
                    <IonSelectOption key={limit} value={String(limit)}>
                      {limit} rows
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            </div>

            <IonSearchbar
              value={searchText}
              onIonInput={(event) => setSearchText(event.detail.value || "")}
              debounce={0}
              placeholder="Search by code, item, brand, pack, barcode..."
              className="db-viewer-searchbar"
            />

            <div className="db-viewer-toolbar">
              <div className="db-viewer-toolbar-copy">
                <IonBadge color="primary">{mainTableState.filteredCount}</IonBadge>
                <span>filtered</span>
                <IonBadge color="medium">{mainTableState.totalCount}</IonBadge>
                <span>total</span>
              </div>
              <IonButton size="small" fill="outline" onClick={() => void loadMainTable()} disabled={metaLoading || mainTableState.loading}>
                Refresh
              </IonButton>
            </div>

            <DbResultsTable
              tableKey={selectedTable}
              rows={mainTableState.rows}
              loading={metaLoading || mainTableState.loading}
              errorText={mainTableState.errorText}
              emptyLabel="No rows found for the selected filters."
              cycleById={cycleById}
              locationById={locationById}
            />
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card db-viewer-clear-card">
          <IonCardHeader>
            <IonCardTitle>Clear Selected Cycle Rows</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="db-viewer-clear-summary">
              <div>
                <span className="db-viewer-clear-label">Select Table</span>
                <IonSelect
                  value={selectedClearTable}
                  interface="popover"
                  onIonChange={(event) => {
                    const value = String(event.detail.value || "cycleFinishedStock") as DbViewerTableKey;
                    setSelectedClearTable(value);
                  }}
                >
                  {tables.map((table) => (
                    <IonSelectOption key={table.key} value={table.key}>
                      {table.label}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>
              <div>
                <span className="db-viewer-clear-label">Table</span>
                <strong>{currentClearTableMeta?.label || "Select table"}</strong>
              </div>
              <div>
                <span className="db-viewer-clear-label">Cycle</span>
                <strong>
                  {currentClearTableMeta?.supportsCycleFilter
                    ? selectedCycleId
                      ? getCycleLabel(cycleById.get(selectedCycleId) || null)
                      : "Select cycle"
                    : "Global"}
                </strong>
              </div>
              <div>
                <span className="db-viewer-clear-label">Scope</span>
                <strong>
                  {currentClearTableMeta?.supportsLocationFilter
                    ? currentLocation?.locationName || "All locations"
                    : "Global"}
                </strong>
              </div>
            </div>

            <IonItem lines="none">
              <IonLabel position="stacked">DB Viewer Password</IonLabel>
              <IonInput
                type="password"
                value={clearPassword}
                placeholder="Enter backend password"
                onIonInput={(event) => setClearPassword(event.detail.value || "")}
              />
            </IonItem>

            <div className="settings-actions settings-actions-inline db-viewer-clear-actions">
              <IonButton
                expand="block"
                color="danger"
                onClick={() => void handleClearRows()}
                disabled={
                  clearingRows ||
                  !currentClearTableMeta ||
                  (currentClearTableMeta.supportsCycleFilter && !selectedCycleId)
                }
              >
                {clearingRows ? "Clearing..." : `Clear ${currentClearTableMeta?.label || "Rows"}`}
              </IonButton>
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => setClearPassword("")}
                disabled={clearingRows || !clearPassword}
              >
                Reset Password
              </IonButton>
            </div>

            <IonNote className="db-viewer-note">
              This clears rows from the selected table only. It does not delete the table structure.
            </IonNote>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Other Tables</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonAccordionGroup
              multiple
              value={openSecondaryTables}
              onIonChange={(event) => {
                const nextValue = event.detail.value;
                if (Array.isArray(nextValue)) {
                  setOpenSecondaryTables(nextValue.map((item) => String(item)));
                  return;
                }
                if (typeof nextValue === "string" && nextValue) {
                  setOpenSecondaryTables([nextValue]);
                  return;
                }
                setOpenSecondaryTables([]);
              }}
              className="db-viewer-accordion-group"
            >
              {secondaryTables.map((table) => {
                const state = secondaryStates[table.key] || emptyTableState();
                return (
                  <IonAccordion key={table.key} value={table.key} className="db-viewer-accordion">
                    <IonItem slot="header" className="db-viewer-accordion-header">
                      <IonLabel>
                        <div className="db-viewer-accordion-title">{table.label}</div>
                        <div className="db-viewer-accordion-subtitle">
                          {table.supportsCycleFilter ? currentCycleLabel : "All records"} •{" "}
                          {table.supportsLocationFilter ? currentLocation?.locationName || "All locations" : "Global"}
                        </div>
                      </IonLabel>
                      <IonBadge color="primary">{state.filteredCount}</IonBadge>
                    </IonItem>
                    <div slot="content" className="db-viewer-accordion-content">
                      <div className="db-viewer-toolbar">
                        <div className="db-viewer-toolbar-copy">
                          <IonBadge color="medium">{state.totalCount}</IonBadge>
                          <span>total</span>
                        </div>
                        <IonButton
                          size="small"
                          fill="outline"
                          onClick={() => void loadSecondaryTable(table.key)}
                          disabled={state.loading || metaLoading}
                        >
                          Refresh
                        </IonButton>
                      </div>

                      <DbResultsTable
                        tableKey={table.key}
                        rows={state.rows}
                        loading={state.loading}
                        errorText={state.errorText}
                        emptyLabel="No rows found for this table."
                        cycleById={cycleById}
                        locationById={locationById}
                      />
                    </div>
                  </IonAccordion>
                );
              })}
            </IonAccordionGroup>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
