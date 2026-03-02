import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Clock, FileText, History, Package } from "lucide-react";
import { calculateDuration, formatDate } from "../helpers";
import { cycleAPI } from "../service/api";

const todayDateString = new Date().toISOString().split("T")[0];

const parseFinishedChangeLog = (rawLog) => {
  if (!rawLog || typeof rawLog !== "string") return [];

  try {
    const parsed = JSON.parse(rawLog);
    const entries = Array.isArray(parsed) ? parsed : [parsed];

    return entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        time: entry.time || null,
        action: entry.action || "Updated",
        changes: entry.changes && typeof entry.changes === "object" ? entry.changes : {},
        user: entry.user || null,
        operatorName: entry.operatorName || entry.operator || null,
        phoneName: entry.phoneName || null,
        matched: entry.matched,
        isMatch: entry.isMatch,
        date: entry.date || null,
        locationMatches: entry.locationMatches || null,
      }))
      .sort((a, b) => {
        const timeA = a.time ? new Date(a.time).getTime() : 0;
        const timeB = b.time ? new Date(b.time).getTime() : 0;
        return timeB - timeA;
      });
  } catch (error) {
    console.warn("Failed to parse ChangeLog entry:", error);
    return [];
  }
};

const parseUnfinishedChangeLog = (rawLog) => {
  if (!rawLog || typeof rawLog !== "string") return [];

  try {
    const parsed = JSON.parse(rawLog);
    const containers = Array.isArray(parsed) ? parsed : [parsed];
    const logs = [];

    containers.forEach((container) => {
      if (!container || typeof container !== "object") return;
      const containerDate = container.date || null;
      const data = container.data && typeof container.data === "object" ? container.data : container;
      const rawLogs = Array.isArray(data.logs)
        ? data.logs
        : Array.isArray(container.logs)
          ? container.logs
          : [];

      rawLogs.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        logs.push({
          time: entry.time || null,
          action: entry.action || "Updated (Unfinished)",
          changes: entry.changes && typeof entry.changes === "object" ? entry.changes : {},
          user: entry.user || null,
          operatorName: entry.operatorName || entry.operator || null,
          phoneName: entry.phoneName || null,
          matched: entry.matched,
          isMatch: entry.isMatch,
          date: entry.date || containerDate || null,
          locationMatches: entry.locationMatches || null,
        });
      });
    });

    return logs.sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeB - timeA;
    });
  } catch (error) {
    console.warn("Failed to parse UnfinishedChangeLog entry:", error);
    return [];
  }
};

const describeChangeValue = (value) => {
  if (value && typeof value === "object") {
    const hasFrom = Object.prototype.hasOwnProperty.call(value, "from");
    const hasTo = Object.prototype.hasOwnProperty.call(value, "to");
    if (hasFrom || hasTo) {
      const from = value.from ?? "—";
      const to = value.to ?? "—";
      return `${from} → ${to}`;
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return value.value ?? "—";
    }
  }

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return value;
};

const formatLogTimestamp = (timestamp) => {
  if (!timestamp) return "Time unknown";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const buildProductKey = (row, index, cycleDate) => {
  const brand = (row.Brand || "").toLowerCase().trim();
  const pack = (row.Pack || "").toString().trim();
  return `${cycleDate || "cycle"}|${brand}|${pack}|${index}`;
};

const normalizeSearchText = (value) =>
  value ? value.toString().toLowerCase().trim() : "";

const normalizePackValue = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const numericValue = parseFloat(value);
  if (Number.isNaN(numericValue)) {
    return normalizeSearchText(value);
  }
  return numericValue.toString();
};

const buildBrandGroups = (rows) => {
  const groups = new Map();

  rows.forEach((row) => {
    const brand = (row.Brand || "").toString().trim();
    if (!brand) return;
    const item = (row.Item || "").toString().trim();
    const pack = (row.Pack || "").toString().trim();
    const code =
      (row.Code || row.CODE || row.code || row["Item Code"] || "")
        .toString()
        .trim();
    const key = `${normalizeSearchText(brand)}|${normalizeSearchText(item)}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        brand,
        item,
        packs: new Set(),
        codes: new Set(),
        rows: [],
      });
    }

    const group = groups.get(key);
    if (pack) {
      group.packs.add(pack);
    }
    if (code) {
      group.codes.add(code);
    }
    group.rows.push({ pack, code });
  });

  return Array.from(groups.values())
    .map((group) => {
      const packs = Array.from(group.packs).sort((a, b) => {
        const aValue = normalizePackValue(a);
        const bValue = normalizePackValue(b);
        if (aValue === bValue) return 0;
        if (aValue === "") return 1;
        if (bValue === "") return -1;
        return parseFloat(aValue) - parseFloat(bValue);
      });
      const codes = Array.from(group.codes).sort((a, b) =>
        a.localeCompare(b)
      );
      const searchText = [
        group.brand,
        group.item,
        codes.join(" "),
        packs.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return { ...group, packs, codes, searchText };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand));
};

const matchesSelectedProduct = (product, brandGroup, pack) => {
  if (!product || !brandGroup || !pack) return false;
  const brandMatch =
    normalizeSearchText(product.Brand) ===
    normalizeSearchText(brandGroup.brand);
  const packMatch =
    normalizePackValue(product.Pack) === normalizePackValue(pack);
  return brandMatch && packMatch;
};

const buildDateRange = (start, end) => {
  const startDate = start ? new Date(`${start}T00:00:00`) : null;
  const endDate = end ? new Date(`${end}T23:59:59`) : null;
  if (startDate && endDate && endDate < startDate) {
    return { start: startDate, end: startDate };
  }
  return { start: startDate, end: endDate };
};

const getCycleDateRange = (cycle) => {
  if (!cycle) return { start: null, end: null };
  const start = cycle.startDate
    ? new Date(`${cycle.startDate}T00:00:00`)
    : null;
  let end = null;
  if (cycle.endDate) {
    end = new Date(`${cycle.endDate}T23:59:59`);
  } else if (cycle.status === "active") {
    end = new Date();
  }
  if (start && Number.isNaN(start.getTime())) {
    return { start: null, end: null };
  }
  if (end && Number.isNaN(end.getTime())) {
    end = cycle.status === "active" ? new Date() : start;
  }
  return { start, end: end || start };
};

const getLogDate = (entry) => {
  if (entry?.time) {
    const parsed = new Date(entry.time);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (entry?.date) {
    const parsed = new Date(entry.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const filterLogsByDate = (logs, range) => {
  if (!range?.start && !range?.end) return logs;
  return logs.filter((entry) => {
    const logDate = getLogDate(entry);
    if (!logDate) return false;
    if (range.start && logDate < range.start) return false;
    if (range.end && logDate > range.end) return false;
    return true;
  });
};

const matchesOperatorFilter = (entry, operatorFilter) => {
  if (!operatorFilter) return true;
  const entryOperator = normalizeSearchText(entry.operatorName || entry.user);
  return entryOperator === normalizeSearchText(operatorFilter);
};

const matchesPhoneFilter = (entry, phoneQuery) => {
  if (!phoneQuery) return true;
  const entryPhone = normalizeSearchText(entry.phoneName);
  return entryPhone.includes(normalizeSearchText(phoneQuery));
};

const filterLogsByMeta = (logs, operatorFilter, phoneQuery) =>
  logs.filter(
    (entry) =>
      matchesOperatorFilter(entry, operatorFilter) &&
      matchesPhoneFilter(entry, phoneQuery)
  );

const LogsTab = ({ allCycles, loading, onRefresh }) => {
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [cycleDataLoading, setCycleDataLoading] = useState(false);
  const [cycleDataError, setCycleDataError] = useState(null);
  const [cycleProducts, setCycleProducts] = useState([]);
  const [selectedProductKey, setSelectedProductKey] = useState(null);
  const [brandRows, setBrandRows] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState(null);
  const [brandQuery, setBrandQuery] = useState("");
  const [selectedBrandKey, setSelectedBrandKey] = useState(null);
  const [selectedPack, setSelectedPack] = useState("");
  const [showBrandSuggestions, setShowBrandSuggestions] = useState(false);
  const [operatorFilter, setOperatorFilter] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");
  const [searchScope, setSearchScope] = useState("cycle");
  const [searchStartDate, setSearchStartDate] = useState(todayDateString);
  const [searchEndDate, setSearchEndDate] = useState(todayDateString);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchActive, setSearchActive] = useState(false);

  const activeProducts = useMemo(
    () => (searchActive ? searchResults : cycleProducts),
    [cycleProducts, searchActive, searchResults]
  );

  const brandGroups = useMemo(
    () => buildBrandGroups(brandRows),
    [brandRows]
  );

  const selectedBrand = useMemo(
    () => brandGroups.find((group) => group.key === selectedBrandKey) || null,
    [brandGroups, selectedBrandKey]
  );

  const filteredBrandGroups = useMemo(() => {
    const normalizedQuery = normalizeSearchText(brandQuery);
    if (!normalizedQuery) {
      return brandGroups.slice(0, 12);
    }
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return brandGroups
      .filter((group) => tokens.every((token) => group.searchText.includes(token)))
      .slice(0, 12);
  }, [brandGroups, brandQuery]);

  const operatorOptions = useMemo(() => {
    const names = new Set();
    [...cycleProducts, ...searchResults].forEach((product) => {
      (product.finishedLogs || []).forEach((entry) => {
        const name = entry.operatorName || entry.user;
        if (name) {
          names.add(name.toString().trim());
        }
      });
      (product.unfinishedLogs || []).forEach((entry) => {
        const name = entry.operatorName || entry.user;
        if (name) {
          names.add(name.toString().trim());
        }
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [cycleProducts, searchResults]);

  const orderedProducts = useMemo(() => {
    if (activeProducts.length === 0) return [];
    return [...activeProducts].sort((a, b) => {
      const logCountA = (a.finishedLogs?.length || 0) + (a.unfinishedLogs?.length || 0);
      const logCountB = (b.finishedLogs?.length || 0) + (b.unfinishedLogs?.length || 0);
      if (logCountB !== logCountA) {
        return logCountB - logCountA;
      }
      const brandComparison = (a.Brand || "").localeCompare(b.Brand || "");
      if (brandComparison !== 0) return brandComparison;
      return (a.Pack || "").toString().localeCompare((b.Pack || "").toString());
    });
  }, [activeProducts]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductKey) return null;
    return activeProducts.find((product) => product.key === selectedProductKey) || null;
  }, [activeProducts, selectedProductKey]);

  const productStats = useMemo(() => {
    const total = activeProducts.length;
    const withLogs = activeProducts.filter(
      (product) =>
        (product.finishedLogs?.length || 0) + (product.unfinishedLogs?.length || 0) > 0
    ).length;
    return {
      total,
      withLogs,
      withoutLogs: total - withLogs,
    };
  }, [activeProducts]);

  const buildProductEntry = useCallback((row, index, cycleDate) => {
    const finishedLogs = parseFinishedChangeLog(row.ChangeLog);
    const unfinishedLogs = parseUnfinishedChangeLog(row.UnfinishedChangeLog);
    return {
      ...row,
      finishedLogs,
      unfinishedLogs,
      key: buildProductKey(row, index, cycleDate),
      cycleDate: cycleDate || null,
    };
  }, []);

  const loadCycleData = useCallback(async (cycle) => {
    if (!cycle) return;

    setCycleDataLoading(true);
    setCycleDataError(null);
    setCycleProducts([]);
    setSelectedProductKey(null);

    try {
      const response = await cycleAPI.getCycleData(cycle.startDate, cycle.cycleId);
      if (!response.success) {
        setCycleDataError(response.message || "Unable to load cycle data.");
        return;
      }

      const rows = response.data || [];
      const enriched = rows.map((row, index) =>
        buildProductEntry(row, index, cycle.startDate)
      );

      setCycleProducts(enriched);
    } catch (error) {
      console.error("Failed to load cycle data:", error);
      setCycleDataError("Failed to load cycle data.");
    } finally {
      setCycleDataLoading(false);
    }
  }, []);

  const handleCycleSelect = useCallback(
    (cycle) => {
      if (!cycle || (selectedCycle && selectedCycle.sno === cycle.sno)) return;
      setSelectedCycle(cycle);
      loadCycleData(cycle);
    },
    [loadCycleData, selectedCycle]
  );

  useEffect(() => {
    if (loading) return;

    if (!allCycles || allCycles.length === 0) {
      setSelectedCycle(null);
      setCycleProducts([]);
      setSelectedProductKey(null);
      return;
    }

    const sortedCycles = [...allCycles].sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    const current =
      selectedCycle &&
      sortedCycles.find((cycle) => cycle.sno === selectedCycle.sno);

    const nextCycle = current || sortedCycles[0];

    if (!selectedCycle || selectedCycle.sno !== nextCycle.sno) {
      setSelectedCycle(nextCycle);
      loadCycleData(nextCycle);
    }
  }, [allCycles, loading, loadCycleData, selectedCycle]);

  useEffect(() => {
    let isActive = true;

    const loadBrands = async () => {
      setBrandLoading(true);
      setBrandError(null);
      try {
        const response = await cycleAPI.getBrands();
        if (!isActive) return;
        if (!response?.success) {
          setBrandError(response?.message || "Unable to load brands.");
          return;
        }
        setBrandRows(response.data || []);
      } catch (error) {
        if (!isActive) return;
        setBrandError(error.message || "Unable to load brands.");
      } finally {
        if (isActive) {
          setBrandLoading(false);
        }
      }
    };

    loadBrands();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedBrand) {
      if (selectedBrandKey) {
        setSelectedBrandKey(null);
      }
      if (selectedPack) {
        setSelectedPack("");
      }
      return;
    }

    if (!selectedPack || !selectedBrand.packs.includes(selectedPack)) {
      setSelectedPack(selectedBrand.packs[0] || "");
    }
  }, [selectedBrand, selectedBrandKey, selectedPack]);

  useEffect(() => {
    if (activeProducts.length === 0) {
      setSelectedProductKey(null);
      return;
    }

    const exists = activeProducts.some((product) => product.key === selectedProductKey);
    if (!exists) {
      setSelectedProductKey(activeProducts[0].key);
    }
  }, [activeProducts, selectedProductKey]);

  useEffect(() => {
    if (!searchActive || searchScope !== "cycle") return;
    if (!selectedBrand || !selectedPack) return;

    const range = buildDateRange(searchStartDate, searchEndDate);
    const updated = cycleProducts
      .map((product) => {
        if (!matchesSelectedProduct(product, selectedBrand, selectedPack)) return null;
        const finishedLogs = filterLogsByMeta(
          filterLogsByDate(product.finishedLogs || [], range),
          operatorFilter,
          phoneQuery
        );
        const unfinishedLogs = filterLogsByMeta(
          filterLogsByDate(product.unfinishedLogs || [], range),
          operatorFilter,
          phoneQuery
        );
        if (finishedLogs.length + unfinishedLogs.length === 0) return null;
        return { ...product, finishedLogs, unfinishedLogs };
      })
      .filter(Boolean);
    setSearchResults(updated);
  }, [
    cycleProducts,
    operatorFilter,
    phoneQuery,
    searchActive,
    searchEndDate,
    searchScope,
    searchStartDate,
    selectedBrand,
    selectedPack,
  ]);

  const handleProductSelect = (product) => {
    setSelectedProductKey(product.key);
  };

  const handleBrandSelect = (group, packOverride) => {
    if (!group) return;
    setSelectedBrandKey(group.key);
    setBrandQuery(
      group.item ? `${group.brand} (${group.item})` : group.brand
    );
    const nextPack = packOverride || group.packs[0] || "";
    setSelectedPack(nextPack);
    setShowBrandSuggestions(false);
    setSearchError(null);
  };

  const resolveBrandFromQuery = () => {
    const query = normalizeSearchText(brandQuery);
    if (!query || brandGroups.length === 0) return null;

    for (const group of brandGroups) {
      const matchedRow = group.rows.find(
        (row) => normalizeSearchText(row.code) === query
      );
      if (matchedRow) {
        return {
          group,
          pack: matchedRow.pack || group.packs[0] || "",
        };
      }
    }

    const directMatch = brandGroups.find((group) =>
      group.searchText.includes(query)
    );
    if (directMatch) {
      return { group: directMatch, pack: directMatch.packs[0] || "" };
    }

    return null;
  };

  const handleSearch = async () => {
    let brandToSearch = selectedBrand;
    let packToSearch = selectedPack;

    if (!brandToSearch || !packToSearch) {
      const resolved = resolveBrandFromQuery();
      if (resolved) {
        brandToSearch = resolved.group;
        packToSearch = resolved.pack;
        handleBrandSelect(resolved.group, resolved.pack);
      }
    }

    if (!brandToSearch || !packToSearch) {
      setSearchError("Select a brand and pack size to search.");
      setSearchResults([]);
      setSearchActive(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const range = buildDateRange(searchStartDate, searchEndDate);

      if (searchScope === "cycle") {
        if (!selectedCycle || cycleProducts.length === 0) {
          setSearchResults([]);
          setSearchActive(true);
          setSearchError("Select a cycle with data before searching.");
          return;
        }
        const filtered = cycleProducts
          .map((product) => {
            if (!matchesSelectedProduct(product, brandToSearch, packToSearch)) return null;
            const finishedLogs = filterLogsByMeta(
              filterLogsByDate(product.finishedLogs || [], range),
              operatorFilter,
              phoneQuery
            );
            const unfinishedLogs = filterLogsByMeta(
              filterLogsByDate(product.unfinishedLogs || [], range),
              operatorFilter,
              phoneQuery
            );
            if (finishedLogs.length + unfinishedLogs.length === 0) return null;
            return { ...product, finishedLogs, unfinishedLogs };
          })
          .filter(Boolean);
        setSearchResults(filtered);
        setSearchActive(true);
        return;
      }

      const cycles = Array.isArray(allCycles) ? allCycles : [];
      const filteredCycles = cycles.filter((cycle) => {
        const { start, end } = getCycleDateRange(cycle);
        if (!start) return false;
        if (range.start && end && end < range.start) return false;
        if (range.end && start > range.end) return false;
        return true;
      });

      if (filteredCycles.length === 0) {
        setSearchResults([]);
        setSearchActive(true);
        setSearchError("No cycles found in the selected date range.");
        return;
      }

      const responses = await Promise.all(
        filteredCycles.map((cycle) =>
          cycleAPI.getCycleData(cycle.startDate, cycle.cycleId)
        )
      );

      const merged = [];
      responses.forEach((response, responseIndex) => {
        if (!response?.success) return;
        const cycle = filteredCycles[responseIndex];
        const rows = response.data || [];
        rows.forEach((row, index) => {
          const product = buildProductEntry(row, index, cycle.startDate);
          if (!matchesSelectedProduct(product, brandToSearch, packToSearch)) return;
          const finishedLogs = filterLogsByMeta(
            filterLogsByDate(product.finishedLogs || [], range),
            operatorFilter,
            phoneQuery
          );
          const unfinishedLogs = filterLogsByMeta(
            filterLogsByDate(product.unfinishedLogs || [], range),
            operatorFilter,
            phoneQuery
          );
          if (finishedLogs.length + unfinishedLogs.length === 0) return;
          merged.push({ ...product, finishedLogs, unfinishedLogs });
        });
      });

      setSearchResults(merged);
      setSearchActive(true);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchError("Search failed. Please retry.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleClearSearch = () => {
    setBrandQuery("");
    setSelectedBrandKey(null);
    setSelectedPack("");
    setShowBrandSuggestions(false);
    setOperatorFilter("");
    setPhoneQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSearchActive(false);
  };

  const renderLogMeta = (entry) => {
    const parts = [];
    const operator = entry.operatorName || entry.user;
    if (operator) {
      parts.push(`Operator: ${operator}`);
    }
    if (entry.phoneName) {
      parts.push(`Phone: ${entry.phoneName}`);
    }
    if (typeof entry.isMatch === "boolean") {
      parts.push(`Matched: ${entry.isMatch ? "Yes" : "No"}`);
    }
    return parts.length > 0 ? parts.join(" • ") : "—";
  };

  const listLoading = searchActive ? searchLoading : cycleDataLoading;
  const listError = searchActive ? searchError : cycleDataError;
  const listTitle = searchActive ? "Search Results" : "Products";
  const listEmptyMessage = searchActive
    ? "No matching products found for this search."
    : "No products recorded for this cycle.";

  const renderLogSection = (title, logs, keyPrefix) => (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <History className="w-4 h-4" />
          {title}
        </div>
        <span className="text-xs text-gray-500">{logs.length} entries</span>
      </div>

      {logs.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500">
          No change history recorded for this product.
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4 max-h-[18rem] overflow-y-auto">
          {logs.map((entry, index) => {
            const changeEntries = Object.entries(entry.changes || {});
            return (
              <div
                key={`${keyPrefix}-${index}`}
                className="border border-gray-200 rounded-lg p-3 bg-white"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <FileText className="w-4 h-4 text-blue-500" />
                    {entry.action}
                  </div>
                  <span className="text-xs text-gray-500">
                    {formatLogTimestamp(entry.time)}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {renderLogMeta(entry)}
                </div>
                <div className="mt-3 space-y-2 text-sm text-gray-700">
                  {changeEntries.length === 0 ? (
                    <div className="text-xs text-gray-500">No changes recorded.</div>
                  ) : (
                    changeEntries.map(([field, value]) => (
                      <div
                        key={`${keyPrefix}-${index}-${field}`}
                        className="flex items-start gap-2"
                      >
                        <span className="text-xs font-semibold uppercase text-gray-500 min-w-[4rem]">
                          {field}
                        </span>
                        <span>{describeChangeValue(value)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-800">Cycle Logs</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Search Logs</h3>
            <p className="text-xs text-gray-500">
              Search by brand, item, pack, or barcode and view finished + unfinished logs.
            </p>
          </div>
          {searchActive && (
            <span className="text-xs text-gray-500">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <div className="relative">
            <label className="text-xs uppercase text-gray-500">Brand / Code</label>
            <input
              value={brandQuery}
              onChange={(event) => {
                setBrandQuery(event.target.value);
                setSelectedBrandKey(null);
                setSelectedPack("");
                setShowBrandSuggestions(true);
                setSearchError(null);
              }}
              onFocus={() => setShowBrandSuggestions(true)}
              onBlur={() => {
                setTimeout(() => {
                  setShowBrandSuggestions(false);
                }, 100);
              }}
              placeholder="Search brand or item code"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {showBrandSuggestions && (
              <div
                className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto"
                onMouseDown={(event) => event.preventDefault()}
              >
                {brandLoading ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    Loading brands...
                  </div>
                ) : brandError ? (
                  <div className="px-3 py-2 text-sm text-red-600">
                    {brandError}
                  </div>
                ) : filteredBrandGroups.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    No matching brands.
                  </div>
                ) : (
                  filteredBrandGroups.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => handleBrandSelect(group)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50"
                    >
                      <div className="text-sm font-semibold text-gray-800">
                        {group.brand}
                      </div>
                      <div className="text-xs text-gray-500">
                        {group.item ? `Item: ${group.item}` : "Item: —"}
                        {group.codes.length > 0 && ` • Code: ${group.codes[0]}`}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Pack size</label>
            <select
              value={selectedPack}
              onChange={(event) => setSelectedPack(event.target.value)}
              disabled={!selectedBrand}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select pack size</option>
              {selectedBrand?.packs.map((pack) => (
                <option key={pack} value={pack}>
                  {pack} ml
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Operator</label>
            <select
              value={operatorFilter}
              onChange={(event) => setOperatorFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All operators</option>
              {operatorOptions.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Phone</label>
            <input
              value={phoneQuery}
              onChange={(event) => setPhoneQuery(event.target.value)}
              placeholder="Search phone name"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Scope</label>
            <select
              value={searchScope}
              onChange={(event) => setSearchScope(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="cycle">Selected cycle</option>
              <option value="all">All cycles</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">From</label>
            <input
              type="date"
              value={searchStartDate}
              onChange={(event) => setSearchStartDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">To</label>
            <input
              type="date"
              value={searchEndDate}
              onChange={(event) => setSearchEndDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSearch}
            disabled={searchLoading}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {searchLoading ? "Searching..." : "Search"}
          </button>
          <button
            onClick={handleClearSearch}
            disabled={searchLoading && searchActive}
            className="px-4 py-2 text-sm font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
          {searchError && (
            <span className="text-sm text-red-600">{searchError}</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <p className="mt-4 text-gray-600">Loading cycles...</p>
        </div>
      ) : !allCycles || allCycles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No cycle history found.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Cycles</h3>
              <span className="text-sm text-gray-500">{allCycles.length} total</span>
            </div>
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {[...allCycles]
                .sort(
                  (a, b) =>
                    new Date(b.startDate).getTime() -
                    new Date(a.startDate).getTime()
                )
                .map((cycle) => {
                const isSelected = selectedCycle?.sno === cycle.sno;
                return (
                  <button
                    key={cycle.sno}
                    onClick={() => handleCycleSelect(cycle)}
                    className={`w-full text-left border rounded-lg p-3 transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-gray-200 hover:border-blue-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                          Cycle #{cycle.sno}
                          {cycle.status === "active" && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {calculateDuration(cycle.startDate, cycle.endDate)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    {searchActive ? "Search scope" : "Selected cycle"}
                  </p>
                  <h3 className="text-lg font-semibold text-gray-800">
                    {searchActive
                      ? searchScope === "all"
                        ? "All cycles"
                        : `Cycle #${selectedCycle?.sno ?? "—"}`
                      : `Cycle #${selectedCycle?.sno ?? "—"}`}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                  {searchActive && searchScope === "all" ? (
                    <>
                      <span>
                        From:{" "}
                        <strong className="text-gray-800">
                          {searchStartDate || "—"}
                        </strong>
                      </span>
                      <span>
                        To:{" "}
                        <strong className="text-gray-800">
                          {searchEndDate || "—"}
                        </strong>
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        Start:{" "}
                        <strong className="text-gray-800">
                          {selectedCycle ? formatDate(selectedCycle.startDate) : "—"}
                        </strong>
                      </span>
                      <span>
                        End:{" "}
                        <strong className="text-gray-800">
                          {selectedCycle ? formatDate(selectedCycle.endDate) : "—"}
                        </strong>
                      </span>
                      <span>
                        Status:{" "}
                        <strong className="text-gray-800">
                          {selectedCycle?.status ?? "—"}
                        </strong>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-gray-600">
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <p className="text-xs uppercase text-gray-500">Products</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {productStats.total}
                  </p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <p className="text-xs uppercase text-gray-500">With logs</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {productStats.withLogs}
                  </p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <p className="text-xs uppercase text-gray-500">No logs</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {productStats.withoutLogs}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold text-gray-800">{listTitle}</h3>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Package className="w-4 h-4" />
                  {orderedProducts.length} entries
                </div>
              </div>

              {listLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
                  <p className="mt-4 text-gray-600">
                    {searchActive ? "Searching logs..." : "Loading products..."}
                  </p>
                </div>
              ) : listError ? (
                <div className="p-6 text-red-600">{listError}</div>
              ) : orderedProducts.length === 0 ? (
                <div className="p-6 text-gray-600">{listEmptyMessage}</div>
              ) : (
                <div className="grid md:grid-cols-5">
                  <div className="md:col-span-2 border-b md:border-b-0 md:border-r border-gray-200 max-h-[22rem] overflow-y-auto">
                    <div className="divide-y divide-gray-200">
                      {orderedProducts.map((product) => {
                        const isSelected = product.key === selectedProductKey;
                        const finishedCount = product.finishedLogs?.length || 0;
                        const unfinishedCount = product.unfinishedLogs?.length || 0;
                        const totalCount = finishedCount + unfinishedCount;
                        return (
                          <button
                            key={product.key}
                            onClick={() => handleProductSelect(product)}
                            className={`w-full text-left p-4 transition-all ${
                              isSelected
                                ? "bg-blue-50 border-l-4 border-blue-500"
                                : "hover:bg-gray-50 border-l-4 border-transparent"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">
                                  {product.Brand || "Unnamed Product"}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Pack: {product.Pack || "—"} ml • Item: {product.Item || "—"}
                                </p>
                                {searchActive && product.cycleDate && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    Cycle: {formatDate(product.cycleDate)}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 text-xs font-medium">
                                <span
                                  className={`px-2 py-0.5 rounded-full ${
                                    totalCount > 0
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-gray-100 text-gray-500"
                                  }`}
                                >
                                  {totalCount} logs
                                </span>
                                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                    F {finishedCount}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                    U {unfinishedCount}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                              <span>Shop: {product.Shop || "0"}</span>
                              <span>Godown: {product.Godown || "0"}</span>
                              <span>Updated: {product.LastUpdated || "—"}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:col-span-3 p-4 space-y-4">
                    {selectedProduct ? (
                      <>
                        <div>
                          <p className="text-xs uppercase text-gray-500">Product</p>
                          <h3 className="text-lg font-semibold text-gray-800">
                            {selectedProduct.Brand || "Unnamed Product"}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Pack: {selectedProduct.Pack || "—"} ml • Item:{" "}
                            {selectedProduct.Item || "—"}
                          </p>
                          {searchActive && selectedProduct.cycleDate && (
                            <p className="text-xs text-gray-500 mt-1">
                              Cycle: {formatDate(selectedProduct.cycleDate)}
                            </p>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                            <p className="text-xs uppercase text-gray-500">Shop</p>
                            <p className="text-lg font-semibold text-gray-800">
                              {selectedProduct.Shop || "0"}
                            </p>
                          </div>
                          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                            <p className="text-xs uppercase text-gray-500">Godown</p>
                            <p className="text-lg font-semibold text-gray-800">
                              {selectedProduct.Godown || "0"}
                            </p>
                          </div>
                          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                            <p className="text-xs uppercase text-gray-500">Last Updated</p>
                            <p className="text-sm font-semibold text-gray-800">
                              {selectedProduct.LastUpdated || "—"}
                            </p>
                          </div>
                        </div>

                        {renderLogSection(
                          "Finished Change Log",
                          selectedProduct.finishedLogs || [],
                          `${selectedProduct.key}-finished`
                        )}
                        {renderLogSection(
                          "Unfinished Change Log",
                          selectedProduct.unfinishedLogs || [],
                          `${selectedProduct.key}-unfinished`
                        )}
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                        <FileText className="w-10 h-10 text-gray-400 mb-3" />
                        Select a product from the list to view its change log.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsTab;
