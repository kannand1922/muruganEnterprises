import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  Package,
  BarChart3,
  X,
  Lock,
  Unlock,
  Smartphone,
  Users,
  List,
} from 'lucide-react';
import { cycleAPI } from '../service/api';

const COUNTS_UNLOCK_STORAGE_KEY = 'cycle.analysis.countsUnlocked';
const LOCATION_STORAGE_KEY = 'desktop_selected_location_code';
const LOCKED_PLACEHOLDER = 'Locked';

const deriveLocationFromChanges = (changes, fallback) => {
  if (fallback) return fallback;
  if (!changes || typeof changes !== 'object') return 'Unknown';
  const keys = Object.keys(changes).map((key) => key.toLowerCase());
  const hasShop = keys.includes('shop');
  const hasGodown = keys.includes('godown');
  if (hasShop && hasGodown) return 'Both';
  if (hasShop) return 'Shop';
  if (hasGodown) return 'Godown';
  return 'Unknown';
};

const describeChangeValue = (value) => {
  if (value && typeof value === 'object') {
    const hasFrom = Object.prototype.hasOwnProperty.call(value, 'from');
    const hasTo = Object.prototype.hasOwnProperty.call(value, 'to');
    if (hasFrom || hasTo) {
      const from = value.from ?? '—';
      const to = value.to ?? '—';
      return `${from} → ${to}`;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return value.value ?? '—';
    }
  }
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return value;
};

const isZeroLike = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const numeric = Number(trimmed);
    return !Number.isNaN(numeric) && numeric === 0;
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return isZeroLike(value.value);
    }
    const hasFrom = Object.prototype.hasOwnProperty.call(value, 'from');
    const hasTo = Object.prototype.hasOwnProperty.call(value, 'to');
    if (hasFrom || hasTo) {
      return isZeroLike(value.from) && isZeroLike(value.to);
    }
  }
  return false;
};

const parseDateKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const [datePart] = value.split(',');
    if (datePart && datePart.trim()) return datePart.trim();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
};

const buildChangeLogEntries = (rawLog, source, productMeta) => {
  if (!rawLog || typeof rawLog !== 'string') return [];
  try {
    const parsed = JSON.parse(rawLog);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const phoneName =
          entry.phoneName ||
          (entry.device && entry.device.model) ||
          'Unknown device';
        const deviceId =
          (entry.device &&
            (entry.device.uuid ||
              entry.device.id ||
              entry.device.deviceId)) ||
          null;
        const operatorName =
          entry.operatorName ||
          entry.user ||
          entry.userName ||
          entry.operator ||
          'Unknown';
        const dateKey = parseDateKey(entry.date || entry.time);
        const changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : {};
        return {
          ...productMeta,
          source,
          time: entry.time || null,
          dateKey,
          action: entry.action || 'Updated',
          operatorName,
          phoneName,
          deviceId,
          changes,
          location: deriveLocationFromChanges(changes, entry.location),
        };
      });
  } catch (error) {
    console.warn('Failed to parse ChangeLog entry:', error);
    return [];
  }
};

const buildUnfinishedEntries = (rawLog, productMeta) => {
  if (!rawLog || typeof rawLog !== 'string') return [];
  try {
    const parsed = JSON.parse(rawLog);
    const containers = Array.isArray(parsed) ? parsed : [parsed];
    const entries = [];

    containers.forEach((container) => {
      if (!container || typeof container !== 'object') return;
      const containerDate = container.date || null;
      const data = container.data && typeof container.data === 'object' ? container.data : container;
      const rawLogs = Array.isArray(data.logs)
        ? data.logs
        : Array.isArray(container.logs)
          ? container.logs
          : [];

      rawLogs.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const phoneName =
          entry.phoneName ||
          (entry.device && entry.device.model) ||
          'Unknown device';
        const deviceId =
          (entry.device &&
            (entry.device.uuid ||
              entry.device.id ||
              entry.device.deviceId)) ||
          null;
        const operatorName =
          entry.operatorName ||
          entry.user ||
          entry.userName ||
          entry.operator ||
          'Unknown';
        const dateKey = parseDateKey(entry.date || containerDate || entry.time);
        const changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : {};
        entries.push({
          ...productMeta,
          source: 'Unfinished',
          time: entry.time || null,
          dateKey,
          action: entry.action || 'Updated (Unfinished)',
          operatorName,
          phoneName,
          deviceId,
          changes,
          location: deriveLocationFromChanges(changes, entry.location),
        });
      });
    });

    return entries;
  } catch (error) {
    console.warn('Failed to parse UnfinishedChangeLog entry:', error);
    return [];
  }
};

const filterEntriesByRange = (entries, range) => {
  if (!range?.start || !range?.end) return entries;
  return entries.filter((entry) => {
    if (!entry.dateKey) return false;
    return entry.dateKey >= range.start && entry.dateKey <= range.end;
  });
};

const AnalysisTab = () => {
  const [cycles, setCycles] = useState([]);
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [locationOptions, setLocationOptions] = useState([]);
  const [location, setLocation] = useState('');
  const [analysisDate, setAnalysisDate] = useState('');
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState('matched');
  const [analysisMode, setAnalysisMode] = useState('overview');
  const [bestSellingData, setBestSellingData] = useState(null);
  const [bestSellingLoading, setBestSellingLoading] = useState(false);
  const [bestSellingError, setBestSellingError] = useState(null);
  const [bestSellingFilter, setBestSellingFilter] = useState('all');
  const [activityEntries, setActivityEntries] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(null);
  const [activityRange, setActivityRange] = useState({ start: '', end: '' });
  const [activityBrandQuery, setActivityBrandQuery] = useState('');
  const [activityOperatorFilter, setActivityOperatorFilter] = useState('');
  const [activityLocationFilter, setActivityLocationFilter] = useState('');
  const [countsUnlocked, setCountsUnlocked] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COUNTS_UNLOCK_STORAGE_KEY) === 'true';
  });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (countsUnlocked) {
      window.localStorage.setItem(COUNTS_UNLOCK_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(COUNTS_UNLOCK_STORAGE_KEY);
    }
  }, [countsUnlocked]);

  const getTodayISO = () => new Date().toISOString().split('T')[0];

  const getCycleMaxDate = (cycle) => {
    const today = getTodayISO();
    if (!cycle) return today;
    const rawEndDate =
      cycle.endDate && cycle.endDate !== '' ? cycle.endDate : today;
    return rawEndDate > today ? today : rawEndDate;
  };

  const clampAnalysisDateToCycle = (cycle, date) => {
    if (!cycle || !date) return date;
    const minDate = cycle.startDate;
    const maxDate = getCycleMaxDate(cycle);
    if (date < minDate) return minDate;
    if (date > maxDate) return maxDate;
    return date;
  };

  const getDefaultAnalysisDate = (cycle) => {
    if (!cycle) return getTodayISO();
    const preferredDate = getCycleMaxDate(cycle);
    return clampAnalysisDateToCycle(cycle, preferredDate);
  };

  const formatCasesAndBottles = (data) => {
    if (!countsUnlocked) return LOCKED_PLACEHOLDER;
    if (!data) return '0C + 0B';
    const cases = Number.isFinite(data.cases) ? data.cases : 0;
    const bottles = Number.isFinite(data.bottles) ? data.bottles : 0;
    return `${cases}C + ${bottles}B`;
  };

  const resolvePreferredLocationCode = (rows, defaultLocationCode) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return '';
    }

    const validCodes = new Set(rows.map((row) => row.locationCode));
    const storedCode =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCATION_STORAGE_KEY)
        : '';
    if (storedCode && validCodes.has(storedCode)) {
      return storedCode;
    }
    if (defaultLocationCode && validCodes.has(defaultLocationCode)) {
      return defaultLocationCode;
    }
    return rows[0].locationCode;
  };

  const fetchCycles = async (locationCode) => {
    try {
      const data = await cycleAPI.getAllCycles();
      if (data.success) {
        const sortedCycles = data.cycles.sort((a, b) => {
          return new Date(b.startDate) - new Date(a.startDate);
        });
        setCycles(sortedCycles);

        const initialCycle = sortedCycles.find(c => c.status === 'active') || sortedCycles[0];
        if (initialCycle) {
          const defaultDate = getDefaultAnalysisDate(initialCycle);
          setSelectedCycle(initialCycle);
          setAnalysisDate(defaultDate);
          if (locationCode) {
            fetchComparisonData(
              initialCycle.startDate,
              locationCode,
              defaultDate,
              initialCycle.cycleId
            );
          }
        }
      } else {
        setError(data.message || 'Failed to fetch cycles');
      }
    } catch (err) {
      setError('Failed to fetch cycles');
      console.error(err);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        const result = await cycleAPI.getLocations();
        if (!result?.success) {
          setError(result?.message || 'Failed to fetch locations');
          return;
        }

        const rows = Array.isArray(result.rows) ? result.rows : [];
        setLocationOptions(rows);
        if (rows.length === 0) {
          setError('No shop locations configured');
        }

        const locationCode = resolvePreferredLocationCode(rows, result.defaultLocationCode);
        setLocation(locationCode);

        if (typeof window !== 'undefined' && locationCode) {
          window.localStorage.setItem(LOCATION_STORAGE_KEY, locationCode);
        }

        await fetchCycles(locationCode);
      } catch (err) {
        setError('Failed to initialize analysis data');
        console.error(err);
      }
    };

    initialize();
  }, []);

  const fetchComparisonData = async (cycleDate, loc, dateFilter, cycleId) => {
    if (!loc) {
      setError('No shop locations configured');
      setComparisonData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const effectiveDate = dateFilter !== undefined ? dateFilter : analysisDate;
      const normalizedDate = effectiveDate && effectiveDate !== '' ? effectiveDate : null;
      const data = await cycleAPI.compareCycle(cycleDate, loc, normalizedDate, cycleId);
      if (data.success) {
        setComparisonData(data);
      } else {
        setError(data.message || 'Failed to fetch comparison data');
      }
    } catch (err) {
      setError('Failed to fetch comparison data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBestSellingData = async (cycleDate, loc, dateFilter, cycleId) => {
    if (!cycleDate || !loc) return;
    setBestSellingLoading(true);
    setBestSellingError(null);
    try {
      const effectiveDate = dateFilter !== undefined ? dateFilter : analysisDate;
      const normalizedDate = effectiveDate && effectiveDate !== '' ? effectiveDate : null;
      const data = await cycleAPI.getBestSelling(cycleDate, loc, normalizedDate, cycleId);
      if (data.success) {
        setBestSellingData(data);
      } else {
        setBestSellingData(null);
        setBestSellingError(data.message || 'Failed to fetch best selling data');
      }
    } catch (err) {
      setBestSellingData(null);
      setBestSellingError('Failed to fetch best selling data');
      console.error(err);
    } finally {
      setBestSellingLoading(false);
    }
  };

  const fetchActivityData = async (cycleDate, cycleId) => {
    if (!cycleDate) return;
    setActivityLoading(true);
    setActivityError(null);
    try {
      const response = await cycleAPI.getCycleData(cycleDate, cycleId);
      if (!response.success) {
        throw new Error(response.message || 'Failed to fetch activity data');
      }
      const entries = [];
      (response.data || []).forEach((row) => {
        const productMeta = {
          brand: row.Brand || '',
          item: row.Item || '',
          pack: row.Pack || '',
        };
        entries.push(
          ...buildChangeLogEntries(row.ChangeLog, 'Finished', productMeta)
        );
        entries.push(
          ...buildUnfinishedEntries(row.UnfinishedChangeLog, productMeta)
        );
      });
      setActivityEntries(entries);
    } catch (err) {
      console.error('Failed to fetch activity data', err);
      setActivityError(err.message || 'Failed to fetch activity data');
      setActivityEntries([]);
    } finally {
      setActivityLoading(false);
    }
  };

  const handleCycleChange = (cycle) => {
    setSelectedCycle(cycle);
    setShowModal(false);
    const nextAnalysisDate = getDefaultAnalysisDate(cycle);
    setAnalysisDate(nextAnalysisDate);
    if (location) {
      fetchComparisonData(cycle.startDate, location, nextAnalysisDate, cycle.cycleId);
    }
    setBestSellingData(null);
    if (analysisMode === 'bestselling') {
      fetchBestSellingData(cycle.startDate, location, nextAnalysisDate, cycle.cycleId);
    }
    const nextActivityEnd = getCycleMaxDate(cycle);
    setActivityRange({ start: cycle.startDate || '', end: nextActivityEnd });
    if (analysisMode === 'activity') {
      fetchActivityData(cycle.startDate, cycle.cycleId);
    }
  };

  const handleLocationChange = (newLocation) => {
    setLocation(newLocation);
    if (typeof window !== 'undefined' && newLocation) {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, newLocation);
    }
    if (selectedCycle) {
      fetchComparisonData(
        selectedCycle.startDate,
        newLocation,
        analysisDate,
        selectedCycle.cycleId
      );
      if (analysisMode === 'bestselling') {
        fetchBestSellingData(
          selectedCycle.startDate,
          newLocation,
          analysisDate,
          selectedCycle.cycleId
        );
      }
    }
  };

  const handleAnalysisDateChange = (value) => {
    if (!selectedCycle) return;
    if (!value) {
      setAnalysisDate('');
      fetchComparisonData(selectedCycle.startDate, location, null, selectedCycle.cycleId);
      if (analysisMode === 'bestselling') {
        fetchBestSellingData(selectedCycle.startDate, location, null, selectedCycle.cycleId);
      }
      return;
    }
    const clampedValue = clampAnalysisDateToCycle(selectedCycle, value);
    setAnalysisDate(clampedValue);
    fetchComparisonData(
      selectedCycle.startDate,
      location,
      clampedValue,
      selectedCycle.cycleId
    );
    if (analysisMode === 'bestselling') {
      fetchBestSellingData(
        selectedCycle.startDate,
        location,
        clampedValue,
        selectedCycle.cycleId
      );
    }
  };

  const handleAnalysisModeChange = (mode) => {
    if (mode === analysisMode) return;
    setAnalysisMode(mode);
    if (mode === 'overview') {
      setBestSellingFilter('all');
    }
    if (mode === 'bestselling' && selectedCycle) {
      setBestSellingFilter('all');
      fetchBestSellingData(
        selectedCycle.startDate,
        location,
        analysisDate,
        selectedCycle.cycleId
      );
    }
    if (mode === 'activity' && selectedCycle) {
      fetchActivityData(selectedCycle.startDate, selectedCycle.cycleId);
    }
    if (mode !== 'activity') {
      setActivityBrandQuery('');
      setActivityOperatorFilter('');
      setActivityLocationFilter('');
    }
  };

  const handleBestSellingFilterChange = (filter) => {
    setBestSellingFilter(filter);
  };

  const handleUnlockRequest = () => {
    setPasswordInput('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const handleLockCounts = () => {
    setCountsUnlocked(false);
    setPasswordInput('');
    setPasswordError('');
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    const trimmedInput = passwordInput.trim();

    if (!trimmedInput) {
      setPasswordError('Password is required.');
      return;
    }

    setPasswordSubmitting(true);
    setPasswordError('');

    try {
      const response = await cycleAPI.verifySettingsPassword(trimmedInput);
      if (response?.success) {
        setCountsUnlocked(true);
        setShowPasswordModal(false);
        setPasswordInput('');
        setPasswordError('');
      } else {
        setPasswordError(response?.message || 'Incorrect password. Please try again.');
      }
    } catch (error) {
      setPasswordError('Failed to verify password. Try again.');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handlePasswordModalClose = () => {
    setShowPasswordModal(false);
    setPasswordInput('');
    setPasswordError('');
  };

  const bestSellingSummary = bestSellingData?.summary;
  const filteredBestSellingProducts = useMemo(() => {
    if (!bestSellingData || !bestSellingData.products) return [];
    switch (bestSellingFilter) {
      case 'scanned':
        return bestSellingData.products.filter((product) => product.status === 'scanned');
      case 'pending':
        return bestSellingData.products.filter((product) => product.status !== 'scanned');
      case 'remaining':
        return bestSellingData.products.filter((product) => (product.remaining?.total || 0) > 0);
      default:
        return bestSellingData.products;
    }
  }, [bestSellingData, bestSellingFilter]);
  const bestSellingFilterLabels = {
    all: 'All products',
    scanned: 'Scanned products',
    pending: 'Pending products',
    remaining: 'Products with stock remaining',
  };
  const bestSellingFilterLabel = bestSellingFilterLabels[bestSellingFilter] || 'products';

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Present';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleActivityRangeChange = (field, value) => {
    setActivityRange((prev) => {
      const next = { ...prev, [field]: value };
      if (next.start && next.end && next.start > next.end) {
        if (field === 'start') {
          next.end = next.start;
        } else {
          next.start = next.end;
        }
      }
      return next;
    });
  };

  const matchesActivityBrand = (entry, query) => {
    if (!query) return true;
    const normalizedQuery = query.toLowerCase().trim();
    const haystack = [entry.brand, entry.item, entry.pack]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return normalizedQuery
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  };

  const matchesActivityOperator = (entry, operator) => {
    if (!operator) return true;
    return (entry.operatorName || '').toLowerCase() === operator.toLowerCase();
  };

  const matchesActivityLocation = (entry, locationFilter) => {
    if (!locationFilter) return true;
    return (entry.location || '').toLowerCase() === locationFilter.toLowerCase();
  };

  useEffect(() => {
    if (!selectedCycle) return;
    const endDate = getCycleMaxDate(selectedCycle);
    setActivityRange({
      start: selectedCycle.startDate || '',
      end: endDate,
    });
    setActivityBrandQuery('');
    setActivityOperatorFilter('');
    setActivityLocationFilter('');
  }, [selectedCycle]);

  useEffect(() => {
    if (!selectedCycle || analysisMode !== 'activity') return;
    fetchActivityData(selectedCycle.startDate, selectedCycle.cycleId);
  }, [analysisMode, selectedCycle]);

  const baseActivityEntries = useMemo(
    () => filterEntriesByRange(activityEntries, activityRange),
    [activityEntries, activityRange]
  );

  const operatorFilterOptions = useMemo(() => {
    const names = new Set();
    baseActivityEntries.forEach((entry) => {
      if (entry.operatorName) {
        names.add(entry.operatorName);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [baseActivityEntries]);

  const locationFilterOptions = useMemo(() => {
    const names = new Set();
    baseActivityEntries.forEach((entry) => {
      if (entry.location) {
        names.add(entry.location);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [baseActivityEntries]);

  const filteredActivityEntries = useMemo(
    () =>
      baseActivityEntries.filter(
        (entry) =>
          matchesActivityBrand(entry, activityBrandQuery) &&
          matchesActivityOperator(entry, activityOperatorFilter) &&
          matchesActivityLocation(entry, activityLocationFilter)
      ),
    [
      activityBrandQuery,
      activityLocationFilter,
      activityOperatorFilter,
      baseActivityEntries,
    ]
  );

  const activitySummary = useMemo(() => {
    const phoneMap = new Map();
    const operatorMap = new Map();
    const dailyOperatorMap = new Map();

    filteredActivityEntries.forEach((entry) => {
      const phone = entry.phoneName || 'Unknown device';
      const operator = entry.operatorName || 'Unknown';
      const dateKey = entry.dateKey || 'Unknown';
      const deviceId = entry.deviceId || null;

      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, {
          count: 0,
          operators: new Set(),
          dates: new Set(),
          deviceIds: new Set(),
        });
      }
      const phoneInfo = phoneMap.get(phone);
      phoneInfo.count += 1;
      phoneInfo.operators.add(operator);
      phoneInfo.dates.add(dateKey);
      if (deviceId) {
        phoneInfo.deviceIds.add(deviceId);
      }

      if (!operatorMap.has(operator)) {
        operatorMap.set(operator, { count: 0, phones: new Set(), dates: new Set() });
      }
      const operatorInfo = operatorMap.get(operator);
      operatorInfo.count += 1;
      operatorInfo.phones.add(phone);
      operatorInfo.dates.add(dateKey);

      const dailyKey = `${dateKey}||${operator}`;
      if (!dailyOperatorMap.has(dailyKey)) {
        dailyOperatorMap.set(dailyKey, { date: dateKey, operator, count: 0, phones: new Set() });
      }
      const dailyInfo = dailyOperatorMap.get(dailyKey);
      dailyInfo.count += 1;
      dailyInfo.phones.add(phone);
    });

    const phones = Array.from(phoneMap.entries()).map(([name, info]) => ({
      name,
      count: info.count,
      operators: Array.from(info.operators),
      days: info.dates.size,
    }));

    const duplicatePhones = Array.from(phoneMap.entries())
      .map(([name, info]) => {
        const deviceCount = info.deviceIds.size;
        const operatorCount = info.operators.size;
        const identityCount = deviceCount || operatorCount;
        return {
          name,
          count: info.count,
          deviceCount,
          operatorCount,
          identityCount,
          identityLabel: deviceCount ? 'devices' : 'operators',
        };
      })
      .filter((phone) => phone.identityCount > 1)
      .sort((a, b) => {
        if (b.identityCount !== a.identityCount) {
          return b.identityCount - a.identityCount;
        }
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.name.localeCompare(b.name);
      });

    const operators = Array.from(operatorMap.entries()).map(([name, info]) => ({
      name,
      count: info.count,
      phones: Array.from(info.phones),
      days: info.dates.size,
    }));

    const operatorDaily = Array.from(dailyOperatorMap.values()).sort((a, b) => {
      if (a.date === b.date) {
        return a.operator.localeCompare(b.operator);
      }
      return a.date > b.date ? -1 : 1;
    });

    return {
      phones,
      operators,
      operatorDaily,
      phoneCount: phoneMap.size,
      operatorCount: operatorMap.size,
      totalEntries: filteredActivityEntries.length,
      duplicatePhones,
    };
  }, [filteredActivityEntries]);

  const sortedActivityEntries = useMemo(() => {
    return [...filteredActivityEntries].sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;
      if (a.dateKey !== b.dateKey) return (a.dateKey || '').localeCompare(b.dateKey || '');
      return (a.operatorName || '').localeCompare(b.operatorName || '');
    });
  }, [filteredActivityEntries]);

  const ProductCard = ({ product }) => {
    const getDifferenceColor = () => {
      if (!product.difference) return '';
      if (product.difference.sign === '+') return 'text-green-600';
      if (product.difference.sign === '-') return 'text-red-600';
      return 'text-gray-600';
    };

    return (
      <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white">
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <h4 className="font-bold text-gray-800">{product.brand}</h4>
            <p className="text-sm text-gray-600">{product.item} - {product.pack}ml</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>₹{product.mrp}</p>
            <p>BPC: {product.bpc}</p>
          </div>
        </div>
        
        <div className="space-y-2">
          {countsUnlocked ? (
            <>
              <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                <span className="text-xs text-gray-600">Master</span>
                <span className="font-semibold text-blue-700">
                  {product.master.cases}C + {product.master.bottles}B
                </span>
              </div>
              
              {product.scanned && (
                <>
                  <div className="flex justify-between items-center p-2 bg-purple-50 rounded">
                    <span className="text-xs text-gray-600">Scanned</span>
                    <span className="font-semibold text-purple-700">
                      {product.scanned.cases}C + {product.scanned.bottles}B
                    </span>
                  </div>
                  
                  {product.difference && (
                    <div className={`text-center font-semibold text-sm ${getDifferenceColor()}`}>
                      {product.difference.sign}{product.difference.cases}C + {product.difference.bottles}B
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 italic text-center">
              Unlock counts to view stock details.
            </p>
          )}
        </div>
      </div>
    );
  };

  const Modal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-bold text-gray-800">Select Cycle</h3>
          <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          <div className="space-y-2">
            {cycles.map((cycle) => (
              <button
                key={cycle.sno}
                onClick={() => handleCycleChange(cycle)}
                className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                  selectedCycle?.sno === cycle.sno
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800">Cycle #{cycle.sno}</span>
                      {cycle.status === 'active' && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
                    </p>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${
                    cycle.status === 'active' ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const PasswordModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-bold text-gray-800">Unlock Counts</h3>
          <button
            onClick={handlePasswordModalClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handlePasswordSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor="analysis-password" className="block text-sm font-medium text-gray-700 mb-1">
              Enter password
            </label>
            <input
              id="analysis-password"
              type="password"
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              disabled={passwordSubmitting}
              autoFocus
            />
            {passwordError && (
              <p className="text-sm text-red-600 mt-2">{passwordError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handlePasswordModalClose}
              disabled={passwordSubmitting}
              className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={passwordSubmitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              {passwordSubmitting ? 'Verifying...' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (!selectedCycle) {
    return (
      <div className="w-full p-6">
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-800 mb-2">No Cycles Available</h3>
          <p className="text-gray-600">Start a cycle to view analysis</p>
        </div>
      </div>
    );
  }

  const minAnalysisDate = selectedCycle.startDate;
  const maxAnalysisDate = (() => {
    const maxDate = getCycleMaxDate(selectedCycle);
    return maxDate < minAnalysisDate ? minAnalysisDate : maxDate;
  })();
  const analysisDateValue = analysisDate && analysisDate !== '' ? analysisDate : '';
    return (
      <div className="w-full p-6 bg-gray-50 min-h-screen">
      {/* Header with Cycle Selector */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Cycle #{selectedCycle.sno}
              {selectedCycle.status === 'active' && (
                <span className="px-2 py-0.5 bg-blue-400 text-white text-xs font-semibold rounded">
                  Current
                </span>
              )}
            </button>
            <div className="text-sm text-gray-600">
              {formatDate(selectedCycle.startDate)} - {formatDate(selectedCycle.endDate)}
            </div>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAnalysisModeChange('overview')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  analysisMode === 'overview'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => handleAnalysisModeChange('bestselling')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  analysisMode === 'bestselling'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Best Selling
              </button>
              <button
                onClick={() => handleAnalysisModeChange('activity')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  analysisMode === 'activity'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Phone & Operator
              </button>
            </div>
            {analysisMode !== 'activity' ? (
              <>
                <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                  <span className="font-medium text-gray-700">Location</span>
                  <select
                    value={location}
                    onChange={(event) => handleLocationChange(event.target.value)}
                    disabled={locationOptions.length === 0}
                    className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {locationOptions.length === 0 ? (
                      <option value="">No shop locations configured</option>
                    ) : (
                      locationOptions.map((option) => (
                        <option key={option.id} value={option.locationCode}>
                          {option.locationName} ({option.locationCode})
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                  <span className="font-medium text-gray-700">Analysis Date</span>
                  <input
                    type="date"
                    value={analysisDateValue}
                    min={minAnalysisDate}
                    max={maxAnalysisDate}
                    onChange={(event) => handleAnalysisDateChange(event.target.value)}
                    className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={countsUnlocked ? handleLockCounts : handleUnlockRequest}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                    countsUnlocked
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {countsUnlocked ? (
                    <>
                      <Unlock className="w-4 h-4" />
                      Lock counts
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Unlock counts
                    </>
                  )}
                </button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                <span className="font-medium text-gray-700">Activity range</span>
                <input
                  type="date"
                  value={activityRange.start}
                  min={minAnalysisDate}
                  max={maxAnalysisDate}
                  onChange={(event) => handleActivityRangeChange('start', event.target.value)}
                  className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <span>to</span>
                <input
                  type="date"
                  value={activityRange.end}
                  min={minAnalysisDate}
                  max={maxAnalysisDate}
                  onChange={(event) => handleActivityRangeChange('end', event.target.value)}
                  className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">Brand</span>
                  <input
                    type="text"
                    value={activityBrandQuery}
                    onChange={(event) => setActivityBrandQuery(event.target.value)}
                    placeholder="Search brand/item/pack"
                    className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">Operator</span>
                  <select
                    value={activityOperatorFilter}
                    onChange={(event) => setActivityOperatorFilter(event.target.value)}
                    className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All</option>
                    {operatorFilterOptions.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">Location</span>
                  <select
                    value={activityLocationFilter}
                    onChange={(event) => setActivityLocationFilter(event.target.value)}
                    className="bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All</option>
                    {locationFilterOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-6 text-sm text-blue-700">
        {analysisMode === 'overview'
          ? analysisDateValue
            ? `Showing scan analysis recorded on ${formatDate(analysisDateValue)}`
            : 'Showing analysis across the entire cycle'
          : analysisMode === 'activity'
          ? activityRange.start && activityRange.end
            ? `Showing phone/operator activity from ${formatDate(activityRange.start)} to ${formatDate(activityRange.end)}`
            : 'Showing phone/operator activity across the cycle'
          : bestSellingSummary
          ? countsUnlocked
            ? `Tracking ${bestSellingSummary.totalTrackedProducts ?? bestSellingData?.trackedProducts ?? 0} best-selling items — ${bestSellingSummary.scannedProductCount ?? 0} scanned, ${bestSellingSummary.notScannedProductCount ?? 0} pending${analysisDateValue ? ` (filtered for ${formatDate(analysisDateValue)})` : ''}`
            : 'Unlock counts to view best-selling metrics.'
          : countsUnlocked
          ? 'Tracking 0 best-selling items'
          : 'Unlock counts to view best-selling metrics.'}
      </div>

      {/* Loading */}
      {analysisMode === 'overview' && loading && (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      )}

      {analysisMode === 'bestselling' && (
        <>
          {bestSellingLoading && (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading best-selling performance...</p>
            </div>
          )}

          {bestSellingError && (
            <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
              <p className="text-red-700 font-medium">{bestSellingError}</p>
            </div>
          )}

          {bestSellingData && !bestSellingLoading && (
            <>
              {countsUnlocked ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white shadow-lg">
                    <Package className="w-8 h-8 mb-2 opacity-80" />
                    <p className="text-2xl font-bold">
                      {bestSellingSummary?.totalTrackedProducts ?? bestSellingData.summary.trackedProducts}
                    </p>
                    <p className="text-sm opacity-90">Total Products</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-4 text-white shadow-lg">
                    <CheckCircle className="w-8 h-8 mb-2 opacity-80" />
                    <p className="text-2xl font-bold">
                      {bestSellingSummary?.scannedProductCount ?? 0}
                    </p>
                    <p className="text-sm opacity-90">Products Scanned</p>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white shadow-lg">
                    <XCircle className="w-8 h-8 mb-2 opacity-80" />
                    <p className="text-2xl font-bold">
                      {bestSellingSummary ? bestSellingSummary.notScannedProductCount : Math.max((bestSellingData.summary.trackedProducts || 0) - (bestSellingSummary?.scannedProductCount || 0), 0)}
                    </p>
                    <p className="text-sm opacity-90">Not Scanned</p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white shadow-lg">
                    <BarChart3 className="w-8 h-8 mb-2 opacity-80" />
                    <p className="text-2xl font-bold">
                      {bestSellingSummary?.totalScannedBottles ?? 0}
                    </p>
                    <p className="text-sm opacity-90">Bottles Scanned</p>
                  </div>
                  <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-lg p-4 text-white shadow-lg">
                    <AlertCircle className="w-8 h-8 mb-2 opacity-80" />
                    <p className="text-2xl font-bold">
                      {bestSellingSummary?.totalRemainingBottles ?? 0}
                    </p>
                    <p className="text-sm opacity-90">Bottles Remaining</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center text-gray-600">
                  Unlock counts to view best-selling metrics.
                </div>
              )}

              <div className="bg-white rounded-lg shadow-md p-4 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'scanned', label: 'Scanned' },
                      { id: 'pending', label: 'Pending' },
                      { id: 'remaining', label: 'Remaining' },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleBestSellingFilterChange(option.id)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          bestSellingFilter === option.id
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-sm text-gray-500">
                    {countsUnlocked
                      ? (
                        <>
                          Showing {filteredBestSellingProducts.length}{' '}
                          of {bestSellingData.products.length} {bestSellingFilterLabel.toLowerCase()}
                        </>
                        )
                      : 'Counts hidden'}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Daily Coverage
                </h3>
                <div className="flex flex-wrap gap-2 text-sm text-gray-600">
                  {bestSellingData.summary.distinctActivityDays.length > 0 ? (
                    bestSellingData.summary.distinctActivityDays.map((date) => (
                      <span
                        key={date}
                        className={`px-3 py-1 rounded-full border ${
                          analysisDateValue === date
                            ? 'border-blue-500 bg-blue-50 text-blue-600'
                            : 'border-gray-200 bg-gray-100'
                        }`}
                      >
                        {formatDate(date)}
                      </span>
                    ))
                  ) : (
                    <span>No activity recorded yet</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredBestSellingProducts.length > 0 ? (
                  filteredBestSellingProducts.map((product) => {
                    const historyEntries = product.history ?? [];
                    const recentHistory = historyEntries.slice(
                      Math.max(historyEntries.length - 7, 0)
                    );
                    const statusLabel =
                      product.status === 'scanned' ? 'Scanned' : 'Pending';
                    const statusClasses =
                      product.status === 'scanned'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-orange-100 text-orange-700';
                    const lastUpdated =
                      product.current?.lastUpdated ||
                      product.latest?.lastUpdated ||
                      'No scans yet';
                    const scannedDisplay = product.current
                      ? formatCasesAndBottles(product.current)
                      : '0C + 0B';
                    const scannedSubtitle = product.current?.lastUpdated
                      ? product.current.lastUpdated
                      : 'Pending scan';
                    const remainingDisplay = formatCasesAndBottles(
                      product.remaining
                    );

                    return (
                      <div
                        key={`${product.brand}-${product.pack}`}
                        className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-lg font-bold text-gray-800">
                            {product.brand}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {product.item} • {product.pack}ml • BPC {product.bpc}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusClasses}`}>
                            {statusLabel}
                          </span>
                          <div className="text-right text-xs text-gray-500">
                            {product.mrp ? <p>₹{product.mrp}</p> : null}
                            {product.barcode && <p>#{product.barcode}</p>}
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-gray-500 mb-4">
                        Last update: {lastUpdated}
                      </p>

                      {countsUnlocked ? (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                            <div className="bg-blue-50 rounded-md p-3 text-center">
                              <p className="text-xs text-blue-600 uppercase tracking-wide">
                                Master Stock
                              </p>
                              <p className="text-lg font-semibold text-blue-700 mt-1">
                                {formatCasesAndBottles(product.master)}
                              </p>
                            </div>
                            <div className="bg-purple-50 rounded-md p-3 text-center">
                              <p className="text-xs text-purple-600 uppercase tracking-wide">
                                {analysisDateValue ? 'Scanned (Selected Day)' : 'Scanned'}
                              </p>
                              <p className="text-lg font-semibold text-purple-700 mt-1">
                                {scannedDisplay}
                              </p>
                              <p className="text-[11px] text-purple-500 mt-1">
                                {scannedSubtitle}
                              </p>
                            </div>
                            <div className="bg-orange-50 rounded-md p-3 text-center">
                              <p className="text-xs text-orange-600 uppercase tracking-wide">
                                Remaining
                              </p>
                              <p className="text-lg font-semibold text-orange-700 mt-1">
                                {remainingDisplay}
                              </p>
                              <p className="text-[11px] text-orange-500 mt-1">
                                {product.remaining?.total ?? 0} bottles left
                              </p>
                            </div>
                          </div>

                          {product.latest && !product.current && (
                            <p className="text-xs text-gray-500 mb-4">
                              Latest recorded total: {formatCasesAndBottles(product.latest)} ({product.latest.lastUpdated || '—'})
                            </p>
                          )}

                          <div>
                            <h5 className="text-sm font-semibold text-gray-700 mb-2">
                              Daily Progress
                            </h5>
                            {recentHistory.length > 0 ? (
                              <div className="border border-gray-200 rounded-md overflow-hidden">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-gray-50">
                                    <tr className="text-left text-gray-600">
                                      <th className="px-3 py-2 font-semibold">Date</th>
                                      <th className="px-3 py-2 font-semibold text-right">
                                        Total Bottles
                                      </th>
                                      <th className="px-3 py-2 font-semibold text-right">
                                        Cases
                                      </th>
                                      <th className="px-3 py-2 font-semibold text-right">
                                        Loose Bottles
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {recentHistory.map((entry, index) => (
                                      <tr
                                        key={`${product.brand}-${entry.date}-${index}`}
                                        className={`border-t ${
                                          analysisDateValue === entry.date
                                            ? 'bg-blue-50'
                                            : 'bg-white'
                                        }`}
                                      >
                                        <td className="px-3 py-2 text-gray-700">
                                          {formatDate(entry.date)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-800 font-medium">
                                          {entry.total}
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-700">
                                          {entry.cases}
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-700">
                                          {entry.bottles}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">
                                No activity recorded yet.
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 italic">
                          Unlock counts to view stock breakdown and daily progress.
                        </p>
                      )}
                    </div>
                  );
                  })
                ) : (
                  <div className="col-span-full">
                    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500">
                      No {bestSellingFilterLabel.toLowerCase()} found for this selection.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {analysisMode === 'activity' && (
        <>
          {activityLoading && (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading activity...</p>
            </div>
          )}

          {activityError && (
            <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
              <p className="text-red-700 font-medium">{activityError}</p>
            </div>
          )}

          {!activityLoading && !activityError && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white shadow-lg">
                  <Smartphone className="w-8 h-8 mb-2 opacity-80" />
                  <p className="text-2xl font-bold">{activitySummary.phoneCount}</p>
                  <p className="text-sm opacity-90">Active Phones</p>
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-4 text-white shadow-lg">
                  <Users className="w-8 h-8 mb-2 opacity-80" />
                  <p className="text-2xl font-bold">{activitySummary.operatorCount}</p>
                  <p className="text-sm opacity-90">Active Operators</p>
                </div>
                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white shadow-lg">
                  <List className="w-8 h-8 mb-2 opacity-80" />
                  <p className="text-2xl font-bold">{activitySummary.totalEntries}</p>
                  <p className="text-sm opacity-90">Total Actions</p>
                </div>
              </div>

              {activitySummary.duplicatePhones.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                  <p className="text-sm font-semibold text-amber-900">
                    Duplicate phone names detected
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    {activitySummary.duplicatePhones
                      .map(
                        (phone) =>
                          `${phone.name} (${phone.identityCount} ${phone.identityLabel})`
                      )
                      .join(', ')}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-white rounded-lg shadow-md p-5">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Phones Used
                  </h3>
                  {activitySummary.phones.length === 0 ? (
                    <p className="text-sm text-gray-500">No phone activity recorded.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-gray-500 text-xs uppercase">
                          <tr className="border-b">
                            <th className="py-2 text-left">Phone</th>
                            <th className="py-2 text-left">Actions</th>
                            <th className="py-2 text-left">Operators</th>
                            <th className="py-2 text-left">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...activitySummary.phones]
                            .sort((a, b) => b.count - a.count)
                            .map((phone) => (
                              <tr key={phone.name} className="border-b last:border-b-0">
                                <td className="py-2 font-semibold text-gray-800">{phone.name}</td>
                                <td className="py-2 text-gray-700">{phone.count}</td>
                                <td className="py-2 text-gray-700">
                                  {phone.operators.length > 0 ? phone.operators.join(', ') : '—'}
                                </td>
                                <td className="py-2 text-gray-700">{phone.days}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow-md p-5">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Operators Used
                  </h3>
                  {activitySummary.operators.length === 0 ? (
                    <p className="text-sm text-gray-500">No operator activity recorded.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-gray-500 text-xs uppercase">
                          <tr className="border-b">
                            <th className="py-2 text-left">Operator</th>
                            <th className="py-2 text-left">Actions</th>
                            <th className="py-2 text-left">Phones</th>
                            <th className="py-2 text-left">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...activitySummary.operators]
                            .sort((a, b) => b.count - a.count)
                            .map((operator) => (
                              <tr key={operator.name} className="border-b last:border-b-0">
                                <td className="py-2 font-semibold text-gray-800">{operator.name}</td>
                                <td className="py-2 text-gray-700">{operator.count}</td>
                                <td className="py-2 text-gray-700">
                                  {operator.phones.length > 0 ? operator.phones.join(', ') : '—'}
                                </td>
                                <td className="py-2 text-gray-700">{operator.days}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-5 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Operator Activity by Day
                </h3>
                {activitySummary.operatorDaily.length === 0 ? (
                  <p className="text-sm text-gray-500">No daily activity recorded.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 text-xs uppercase">
                        <tr className="border-b">
                          <th className="py-2 text-left">Date</th>
                          <th className="py-2 text-left">Operator</th>
                          <th className="py-2 text-left">Actions</th>
                          <th className="py-2 text-left">Phones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activitySummary.operatorDaily.map((row) => (
                          <tr key={`${row.date}-${row.operator}`} className="border-b last:border-b-0">
                            <td className="py-2 text-gray-700">{row.date === 'Unknown' ? '—' : formatDate(row.date)}</td>
                            <td className="py-2 font-semibold text-gray-800">{row.operator}</td>
                            <td className="py-2 text-gray-700">{row.count}</td>
                            <td className="py-2 text-gray-700">
                              {Array.from(row.phones).join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg shadow-md p-5">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <List className="w-5 h-5" />
                  Activity Log
                </h3>
                {sortedActivityEntries.length === 0 ? (
                  <p className="text-sm text-gray-500">No activity entries found.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[28rem]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 text-xs uppercase">
                        <tr className="border-b">
                          <th className="py-2 text-left">Time</th>
                          <th className="py-2 text-left">Operator</th>
                          <th className="py-2 text-left">Phone</th>
                          <th className="py-2 text-left">Location</th>
                          <th className="py-2 text-left">Action</th>
                          <th className="py-2 text-left">Product</th>
                          <th className="py-2 text-left">Changes</th>
                          <th className="py-2 text-left">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedActivityEntries.map((entry, index) => (
                          <tr
                            key={`${entry.time || entry.dateKey}-${entry.operatorName}-${index}`}
                            className="border-b last:border-b-0"
                          >
                            <td className="py-2 text-gray-700">
                              {entry.time ? formatDateTime(entry.time) : entry.dateKey || '—'}
                            </td>
                            <td className="py-2 text-gray-800 font-semibold">
                              {entry.operatorName || 'Unknown'}
                            </td>
                            <td className="py-2 text-gray-700">{entry.phoneName || '—'}</td>
                            <td className="py-2 text-gray-700">{entry.location || '—'}</td>
                            <td className="py-2 text-gray-700">{entry.action || '—'}</td>
                            <td className="py-2 text-gray-700">
                              {entry.brand || '—'} {entry.pack ? `${entry.pack}ml` : ''}{' '}
                              {entry.item ? `• ${entry.item}` : ''}
                            </td>
                            <td className="py-2 text-gray-700">
                              {entry.changes && Object.keys(entry.changes).length > 0
                                ? (() => {
                                    const visibleChanges = Object.entries(entry.changes).filter(
                                      ([, value]) => !isZeroLike(value)
                                    );
                                    if (visibleChanges.length === 0) {
                                      return '—';
                                    }
                                    return visibleChanges
                                      .map(([field, value]) => `${field}: ${describeChangeValue(value)}`)
                                      .join(', ');
                                  })()
                                : '—'}
                            </td>
                            <td className="py-2 text-gray-700">{entry.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Error */}
      {analysisMode === 'overview' && error && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {analysisMode === 'overview' && comparisonData && !loading && (
        <>
          {countsUnlocked ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white shadow-lg">
                <Package className="w-8 h-8 mb-2 opacity-80" />
                <p className="text-2xl font-bold">{comparisonData.summary.totalMasterProducts}</p>
                <p className="text-sm opacity-90">Total Products</p>
              </div>
              
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-4 text-white shadow-lg">
                <CheckCircle className="w-8 h-8 mb-2 opacity-80" />
                <p className="text-2xl font-bold">{comparisonData.summary.matchedCount}</p>
                <p className="text-sm opacity-90">Matched ({comparisonData.summary.accuracyPercentage}%)</p>
              </div>
              
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white shadow-lg">
                <XCircle className="w-8 h-8 mb-2 opacity-80" />
                <p className="text-2xl font-bold">{comparisonData.summary.unmatchedCount}</p>
                <p className="text-sm opacity-90">Unmatched</p>
              </div>
              
              <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-lg p-4 text-white shadow-lg">
                <AlertCircle className="w-8 h-8 mb-2 opacity-80" />
                <p className="text-2xl font-bold">{comparisonData.summary.nonScannedCount}</p>
                <p className="text-sm opacity-90">Not Scanned</p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center text-gray-600">
              Unlock counts to view overview metrics.
            </div>
          )}

          {/* Stock Summary */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Stock Summary
            </h3>
            {countsUnlocked ? (
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Master Stock</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {comparisonData.summary.totalMasterBottles}
                  </p>
                  <p className="text-xs text-gray-500">bottles</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Scanned Stock</p>
                  <p className="text-3xl font-bold text-purple-600">
                    {comparisonData.summary.totalScannedBottles}
                  </p>
                  <p className="text-xs text-gray-500">bottles</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Difference</p>
                  <p className={`text-3xl font-bold ${
                    comparisonData.summary.totalDifference > 0 
                      ? 'text-green-600' 
                      : comparisonData.summary.totalDifference < 0 
                      ? 'text-red-600' 
                      : 'text-gray-600'
                  }`}>
                    {comparisonData.summary.totalDifference >= 0 ? '+' : ''}
                    {comparisonData.summary.totalDifference}
                  </p>
                  <p className="text-xs text-gray-500">bottles</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600 italic text-center">
                Unlock counts to view stock summary.
              </p>
            )}
          </div>

          {/* Tabs */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="flex border-b">
              <button
                onClick={() => setActiveTab('matched')}
                className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                  activeTab === 'matched'
                    ? 'bg-green-50 text-green-700 border-b-2 border-green-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Matched{countsUnlocked ? ` (${comparisonData.matched.length})` : ''}
                </div>
              </button>
              
              <button
                onClick={() => setActiveTab('unmatched')}
                className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                  activeTab === 'unmatched'
                    ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <XCircle className="w-5 h-5" />
                  Unmatched{countsUnlocked ? ` (${comparisonData.unmatched.length})` : ''}
                </div>
              </button>
              
              <button
                onClick={() => setActiveTab('notscanned')}
                className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                  activeTab === 'notscanned'
                    ? 'bg-red-50 text-red-700 border-b-2 border-red-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Not Scanned{countsUnlocked ? ` (${comparisonData.nonScanned.length})` : ''}
                </div>
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-6">
              {activeTab === 'matched' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {comparisonData.matched.length > 0 ? (
                    comparisonData.matched.map((product, idx) => (
                      <ProductCard key={idx} product={product} />
                    ))
                  ) : (
                    <div className="col-span-full text-center py-12 text-gray-500">
                      No matched products found
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'unmatched' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {comparisonData.unmatched.length > 0 ? (
                    comparisonData.unmatched.map((product, idx) => (
                      <ProductCard key={idx} product={product} />
                    ))
                  ) : (
                    <div className="col-span-full text-center py-12 text-gray-500">
                      No unmatched products found
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'notscanned' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {comparisonData.nonScanned.length > 0 ? (
                    comparisonData.nonScanned.map((product, idx) => (
                      <ProductCard key={idx} product={product} />
                    ))
                  ) : (
                    <div className="col-span-full text-center py-12 text-gray-500">
                      All products have been scanned
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal */}
      {showModal && <Modal />}
      {showPasswordModal && <PasswordModal />}
    </div>
  );
};

export default AnalysisTab;
