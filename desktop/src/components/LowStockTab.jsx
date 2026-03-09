import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellOff,
  BellRing,
  CheckCircle2,
  ChevronRight,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cycleAPI } from '../service/api';

const LOW_STOCK_VIEWS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    description: 'Quick status for every location.',
  },
  {
    id: 'thresholds',
    label: 'Thresholds',
    icon: SlidersHorizontal,
    description: 'Manage pack and product alert rules.',
  },
  {
    id: 'notifications',
    label: 'Notification Settings',
    icon: Settings2,
    description: 'Control push alerts and review recent runs.',
  },
];

const NOTIFICATION_STATUS_LABELS = {
  all: 'All',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
  pending: 'Pending',
};

function formatGeneratedAt(value) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function createRuleRow(type) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    packValue: '',
    itemCode: '',
    thresholdBottles: '',
  };
}

function mapRulesForDraft(rows, type) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row, index) => ({
    id: `${type}-${index}-${String(row?.packValue || row?.itemCode || 'rule')}`,
    packValue: row?.packValue || '',
    itemCode: row?.itemCode || '',
    thresholdBottles: String(row?.thresholdBottles ?? ''),
  }));
}

function sanitizeRulesForSave(rows, field) {
  return rows
    .map((row) => ({
      [field]: String(row?.[field] || '').trim(),
      thresholdBottles: Number(row?.thresholdBottles),
    }))
    .filter((row) => row[field] && Number.isFinite(row.thresholdBottles) && row.thresholdBottles >= 0);
}

function SummaryCard({ label, value, tone = 'slate', hint }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };

  return (
    <div className={`rounded-2xl border p-5 ${tones[tone] || tones.slate}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold">{value}</p>
      {hint ? <p className="mt-2 text-sm text-slate-600">{hint}</p> : null}
    </div>
  );
}

function SectionShell({ title, description, action, children }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function LocationPicker({ locations, selectedLocationId, onSelect, loading = false }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Locations</h3>
        <p className="mt-1 text-sm text-slate-500">Pick one location and work on a single clear panel.</p>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Loading locations...
          </div>
        ) : locations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
            No locations available.
          </div>
        ) : (
          locations.map((location) => {
            const selected = String(location.id) === String(selectedLocationId);
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => onSelect(String(location.id))}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div className="font-medium">{location.locationName}</div>
                  <div className={`text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {location.locationCode}
                  </div>
                </div>
                <ChevronRight className={`h-4 w-4 ${selected ? 'text-white' : 'text-slate-400'}`} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function RuleEditor({
  title,
  description,
  field,
  fieldLabel,
  rows,
  onAdd,
  onChange,
  onRemove,
  placeholder,
}) {
  return (
    <SectionShell
      title={title}
      description={description}
      action={
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
          Add Rule
        </button>
      }
    >
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No rules added yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_160px_auto]">
              <label className="text-sm font-medium text-slate-600">
                {fieldLabel}
                <input
                  value={row[field]}
                  onChange={(event) => onChange(index, field, event.target.value)}
                  placeholder={placeholder}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                Threshold
                <input
                  type="number"
                  min="0"
                  value={row.thresholdBottles}
                  onChange={(event) => onChange(index, 'thresholdBottles', event.target.value)}
                  placeholder="0"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                />
              </label>
              <div className="flex items-end justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <X className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

const LowStockTab = ({ onRefresh, showToast }) => {
  const [activeView, setActiveView] = useState('overview');
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationOptions, setLocationOptions] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overview, setOverview] = useState({
    generatedAt: '',
    locationCount: 0,
    enabledLocationCount: 0,
    locationsWithLowStock: 0,
    totalLowProducts: 0,
    rows: [],
  });

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
  const [sendingNotificationRun, setSendingNotificationRun] = useState(false);

  const [locationSettings, setLocationSettings] = useState(null);
  const [locationProducts, setLocationProducts] = useState(null);
  const [thresholdDraft, setThresholdDraft] = useState({
    packRules: [],
    productRules: [],
  });
  const [notificationEnabledDraft, setNotificationEnabledDraft] = useState(false);

  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationRows, setNotificationRows] = useState([]);
  const [notificationSummary, setNotificationSummary] = useState({
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    totalLowCount: 0,
  });
  const [notificationFilters, setNotificationFilters] = useState(() => {
    const today = getTodayDateKey();
    return {
      status: 'all',
      dateFrom: today,
      dateTo: today,
    };
  });

  const selectedLocation = useMemo(
    () => locationOptions.find((row) => String(row.id) === String(selectedLocationId)) || null,
    [locationOptions, selectedLocationId]
  );

  const loadLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const result = await cycleAPI.getLocations();
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      setLocationOptions(rows);
      setSelectedLocationId((current) => {
        if (current && rows.some((row) => String(row.id) === String(current))) {
          return current;
        }
        return rows[0] ? String(rows[0].id) : '';
      });
    } catch (error) {
      console.error('Failed to load locations', error);
      showToast?.(error.message || 'Failed to load locations', 'error');
    } finally {
      setLocationsLoading(false);
    }
  }, [showToast]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const result = await cycleAPI.getLowStockOverview();
      if (!result?.success) {
        throw new Error(result?.message || 'Failed to load low stock overview');
      }

      setOverview({
        generatedAt: result.generatedAt || '',
        locationCount: Number(result.locationCount || 0),
        enabledLocationCount: Number(result.enabledLocationCount || 0),
        locationsWithLowStock: Number(result.locationsWithLowStock || 0),
        totalLowProducts: Number(result.totalLowProducts || 0),
        rows: Array.isArray(result.rows) ? result.rows : [],
      });
    } catch (error) {
      console.error('Failed to load low stock overview', error);
      showToast?.(error.message || 'Failed to load low stock overview', 'error');
    } finally {
      setOverviewLoading(false);
    }
  }, [showToast]);

  const loadLocationWorkspace = useCallback(
    async (shopLocationId) => {
      if (!shopLocationId) {
        setLocationSettings(null);
        setLocationProducts(null);
        setThresholdDraft({ packRules: [], productRules: [] });
        setNotificationEnabledDraft(false);
        return;
      }

      setWorkspaceLoading(true);
      try {
        const [settingsResult, productsResult] = await Promise.all([
          cycleAPI.getLowStockSettings(shopLocationId),
          cycleAPI.getLowStockProducts(shopLocationId),
        ]);

        if (!settingsResult?.success) {
          throw new Error(settingsResult?.message || 'Failed to load threshold settings');
        }
        if (!productsResult?.success) {
          throw new Error(productsResult?.message || 'Failed to load low stock products');
        }

        const settingsData = settingsResult.data || null;
        const productData = productsResult.data || null;

        setLocationSettings(settingsData);
        setLocationProducts(productData);
        setThresholdDraft({
          packRules: mapRulesForDraft(settingsData?.packRules, 'pack'),
          productRules: mapRulesForDraft(settingsData?.productRules, 'product'),
        });
        setNotificationEnabledDraft(Boolean(settingsData?.notificationsEnabled));
      } catch (error) {
        console.error('Failed to load location low stock workspace', error);
        showToast?.(error.message || 'Failed to load location low stock details', 'error');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [showToast]
  );

  const loadNotificationHistory = useCallback(async () => {
    if (!selectedLocation?.locationCode) {
      setNotificationRows([]);
      setNotificationSummary({
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        totalLowCount: 0,
      });
      return;
    }

    setNotificationLoading(true);
    try {
      const result = await cycleAPI.getLowStockNotifications({
        location: selectedLocation.locationCode,
        status: notificationFilters.status,
        dateFrom: notificationFilters.dateFrom,
        dateTo: notificationFilters.dateTo,
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Failed to load notification history');
      }

      setNotificationRows(Array.isArray(result.rows) ? result.rows : []);
      setNotificationSummary({
        total: Number(result.summary?.total || 0),
        sent: Number(result.summary?.sent || 0),
        failed: Number(result.summary?.failed || 0),
        skipped: Number(result.summary?.skipped || 0),
        pending: Number(result.summary?.pending || 0),
        totalLowCount: Number(result.summary?.totalLowCount || 0),
      });
    } catch (error) {
      console.error('Failed to load notification history', error);
      showToast?.(error.message || 'Failed to load notification history', 'error');
    } finally {
      setNotificationLoading(false);
    }
  }, [notificationFilters, selectedLocation, showToast]);

  useEffect(() => {
    void loadLocations();
    void loadOverview();
  }, [loadLocations, loadOverview]);

  useEffect(() => {
    if (!selectedLocationId) return;
    void loadLocationWorkspace(selectedLocationId);
  }, [loadLocationWorkspace, selectedLocationId]);

  useEffect(() => {
    if (activeView !== 'notifications' || !selectedLocationId) return;
    void loadNotificationHistory();
  }, [activeView, loadNotificationHistory, selectedLocationId]);

  const handleCheckAndNotify = useCallback(
    async (locationCode = '') => {
      setSendingNotificationRun(true);
      try {
        const result = await cycleAPI.checkLowStockNow({
          location: locationCode,
          dryRun: false,
        });

        if (!result?.success) {
          throw new Error(result?.message || 'Low stock check failed');
        }

        const sentCount = (result.notifyResults || []).filter((row) => row.sent).length;
        showToast?.(
          sentCount > 0
            ? `Low stock notification sent (${sentCount} location${sentCount > 1 ? 's' : ''})`
            : 'Low stock checked. No new notification needed.',
          sentCount > 0 ? 'success' : 'info'
        );

        await Promise.all([
          loadOverview(),
          selectedLocationId ? loadLocationWorkspace(selectedLocationId) : Promise.resolve(),
        ]);
        if (activeView === 'notifications') {
          await loadNotificationHistory();
        }
        onRefresh?.();
      } catch (error) {
        console.error('Low stock notify failed', error);
        showToast?.(error.message || 'Low stock notify failed', 'error');
      } finally {
        setSendingNotificationRun(false);
      }
    },
    [activeView, loadLocationWorkspace, loadNotificationHistory, loadOverview, onRefresh, selectedLocationId, showToast]
  );

  const handleThresholdRuleChange = useCallback((type, index, field, value) => {
    setThresholdDraft((current) => ({
      ...current,
      [type]: current[type].map((row, rowIndex) => (
        rowIndex === index ? { ...row, [field]: value } : row
      )),
    }));
  }, []);

  const handleAddRule = useCallback((type) => {
    setThresholdDraft((current) => ({
      ...current,
      [type]: [...current[type], createRuleRow(type === 'packRules' ? 'pack' : 'product')],
    }));
  }, []);

  const handleRemoveRule = useCallback((type, index) => {
    setThresholdDraft((current) => ({
      ...current,
      [type]: current[type].filter((_, rowIndex) => rowIndex !== index),
    }));
  }, []);

  const handleSaveThresholds = useCallback(async () => {
    if (!selectedLocationId) return;

    setSavingThresholds(true);
    try {
      const result = await cycleAPI.updateLowStockSettings(selectedLocationId, {
        packRules: sanitizeRulesForSave(thresholdDraft.packRules, 'packValue'),
        productRules: sanitizeRulesForSave(thresholdDraft.productRules, 'itemCode'),
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Failed to save threshold settings');
      }

      showToast?.('Threshold settings saved', 'success');
      await Promise.all([loadOverview(), loadLocationWorkspace(selectedLocationId)]);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to save threshold settings', error);
      showToast?.(error.message || 'Failed to save threshold settings', 'error');
    } finally {
      setSavingThresholds(false);
    }
  }, [loadLocationWorkspace, loadOverview, onRefresh, selectedLocationId, showToast, thresholdDraft]);

  const handleSaveNotificationSettings = useCallback(async () => {
    if (!selectedLocationId) return;

    setSavingNotificationSettings(true);
    try {
      const result = await cycleAPI.updateLowStockSettings(selectedLocationId, {
        notificationsEnabled: notificationEnabledDraft,
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Failed to save notification settings');
      }

      setLocationSettings(result.data || null);
      setNotificationEnabledDraft(Boolean(result.data?.notificationsEnabled));
      showToast?.('Notification settings saved', 'success');
      await loadOverview();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to save notification settings', error);
      showToast?.(error.message || 'Failed to save notification settings', 'error');
    } finally {
      setSavingNotificationSettings(false);
    }
  }, [loadOverview, notificationEnabledDraft, onRefresh, selectedLocationId, showToast]);

  const thresholdCounts = useMemo(() => ({
    packRules: thresholdDraft.packRules.filter((row) => String(row.packValue || '').trim()).length,
    productRules: thresholdDraft.productRules.filter((row) => String(row.itemCode || '').trim()).length,
  }), [thresholdDraft]);

  const overviewRows = useMemo(
    () => [...overview.rows].sort((a, b) => Number(b.lowCount || 0) - Number(a.lowCount || 0)),
    [overview.rows]
  );

  return (
    <div className="w-full bg-slate-100/60 p-6">
      <div className="space-y-6">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Low Stock Alerts</p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-900">Clear workflow for overview, thresholds, and notifications.</h2>
              <p className="mt-2 text-sm text-slate-500">
                Overview opens first. Thresholds and notification settings now live in separate focused pages.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadOverview();
                  if (selectedLocationId) {
                    void loadLocationWorkspace(selectedLocationId);
                  }
                  if (activeView === 'notifications') {
                    void loadNotificationHistory();
                  }
                }}
                disabled={overviewLoading || workspaceLoading || notificationLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${(overviewLoading || workspaceLoading || notificationLoading) ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleCheckAndNotify('')}
                disabled={sendingNotificationRun}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                <BellRing className="h-4 w-4" />
                {sendingNotificationRun ? 'Checking...' : 'Run Low Stock Check'}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            {LOW_STOCK_VIEWS.map((view) => {
              const Icon = view.icon;
              const active = activeView === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveView(view.id)}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`rounded-xl p-2 ${active ? 'bg-white/10' : 'bg-white'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-semibold">{view.label}</div>
                      <div className={`text-sm ${active ? 'text-slate-300' : 'text-slate-500'}`}>{view.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {activeView === 'overview' && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <SummaryCard
                label="Enabled Locations"
                value={overviewLoading ? '...' : overview.enabledLocationCount}
                tone="emerald"
                hint="Locations allowed to receive push alerts."
              />
              <SummaryCard
                label="Low Products"
                value={overviewLoading ? '...' : overview.totalLowProducts}
                tone="amber"
                hint="Combined low-stock matches across all locations."
              />
            </div>

            <SectionShell
              title="Overview"
              description={`Last refreshed: ${formatGeneratedAt(overview.generatedAt)}`}
            >
              {overviewLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  Loading low stock overview...
                </div>
              ) : overviewRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  No locations available.
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {overviewRows.map((row) => {
                    const needsAttention = Number(row.lowCount || 0) > 0;
                    return (
                      <div key={row.shopLocationId} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-lg font-semibold text-slate-900">{row.locationName}</h4>
                            <p className="text-sm text-slate-500">{row.locationCode}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
                            <span className={`rounded-full px-3 py-1 ${row.notificationsEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {row.notificationsEnabled ? 'Alerts On' : 'Alerts Off'}
                            </span>
                            <span className={`rounded-full px-3 py-1 ${needsAttention ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                              {needsAttention ? 'Needs Refill' : 'Stable'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Low Products</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-900">{row.lowCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Pack Rules</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-900">{row.packRuleCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Product Rules</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-900">{row.productRuleCount}</p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLocationId(String(row.shopLocationId));
                              setActiveView('thresholds');
                            }}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                          >
                            Thresholds
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLocationId(String(row.shopLocationId));
                              setActiveView('notifications');
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Notification Settings
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionShell>
          </div>
        )}

        {activeView === 'thresholds' && (
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <LocationPicker
              locations={locationOptions}
              selectedLocationId={selectedLocationId}
              onSelect={setSelectedLocationId}
              loading={locationsLoading}
            />

            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <SummaryCard
                  label="Pack Rules"
                  value={workspaceLoading ? '...' : thresholdCounts.packRules}
                  tone="blue"
                  hint="Alert thresholds mapped by pack size."
                />
                <SummaryCard
                  label="Product Rules"
                  value={workspaceLoading ? '...' : thresholdCounts.productRules}
                  tone="slate"
                  hint="Item-code specific alert thresholds."
                />
                <SummaryCard
                  label="Current Low Products"
                  value={workspaceLoading ? '...' : Number(locationProducts?.lowCount || 0)}
                  tone="amber"
                  hint="Matches at the selected location right now."
                />
              </div>

              <SectionShell
                title={selectedLocation ? `${selectedLocation.locationName} Thresholds` : 'Thresholds'}
                description={selectedLocation ? `${selectedLocation.locationCode} · keep the rules minimal and explicit.` : 'Select a location to edit rules.'}
                action={
                  <button
                    type="button"
                    onClick={() => void handleSaveThresholds()}
                    disabled={!selectedLocationId || savingThresholds}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {savingThresholds ? 'Saving...' : 'Save Thresholds'}
                  </button>
                }
              >
                {workspaceLoading && !locationSettings ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    Loading threshold settings...
                  </div>
                ) : !selectedLocationId ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    Select a location to manage thresholds.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <RuleEditor
                      title="Pack Thresholds"
                      description="Use pack values such as 180 ML or 750 ML."
                      field="packValue"
                      fieldLabel="Pack"
                      rows={thresholdDraft.packRules}
                      onAdd={() => handleAddRule('packRules')}
                      onChange={(index, field, value) => handleThresholdRuleChange('packRules', index, field, value)}
                      onRemove={(index) => handleRemoveRule('packRules', index)}
                      placeholder="e.g. 750 ML"
                    />

                    <RuleEditor
                      title="Product Thresholds"
                      description="Use exact item codes when a product needs a different alert level."
                      field="itemCode"
                      fieldLabel="Item Code"
                      rows={thresholdDraft.productRules}
                      onAdd={() => handleAddRule('productRules')}
                      onChange={(index, field, value) => handleThresholdRuleChange('productRules', index, field, value)}
                      onRemove={(index) => handleRemoveRule('productRules', index)}
                      placeholder="e.g. 100234"
                    />
                  </div>
                )}
              </SectionShell>

              <SectionShell
                title="Current Low Stock Preview"
                description="A short list for context while you adjust thresholds."
              >
                {workspaceLoading && !locationProducts ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    Loading current low-stock products...
                  </div>
                ) : !locationProducts || !Array.isArray(locationProducts.rows) || locationProducts.rows.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    No low-stock products at this location right now.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {locationProducts.rows.slice(0, 12).map((row, index) => (
                      <div key={`${row.itemCode}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{row.displayName || row.brandName || row.itemName || row.itemCode}</p>
                            <p className="text-sm text-slate-500">{row.itemCode || 'No item code'} · {row.packValue || 'No pack'}</p>
                          </div>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                            {row.ruleType || 'rule'}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <div className="text-slate-400">Current</div>
                            <div className="mt-1 font-semibold text-rose-600">{row.currentBottles}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <div className="text-slate-400">Threshold</div>
                            <div className="mt-1 font-semibold text-slate-900">{row.thresholdBottles}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionShell>
            </div>
          </div>
        )}

        {activeView === 'notifications' && (
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <LocationPicker
              locations={locationOptions}
              selectedLocationId={selectedLocationId}
              onSelect={setSelectedLocationId}
              loading={locationsLoading}
            />

            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <SummaryCard
                  label="Alerts"
                  value={workspaceLoading ? '...' : (notificationEnabledDraft ? 'On' : 'Off')}
                  tone={notificationEnabledDraft ? 'emerald' : 'slate'}
                  hint="Push notifications for the selected location."
                />
                <SummaryCard
                  label="Runs"
                  value={notificationLoading ? '...' : notificationSummary.total}
                  tone="blue"
                  hint="Notification attempts in the selected date range."
                />
                <SummaryCard
                  label="Sent"
                  value={notificationLoading ? '...' : notificationSummary.sent}
                  tone="amber"
                  hint="Successful pushes in the selected date range."
                />
              </div>

              <SectionShell
                title={selectedLocation ? `${selectedLocation.locationName} Notifications` : 'Notification Settings'}
                description={selectedLocation ? `${selectedLocation.locationCode} · keep alert delivery separate from threshold editing.` : 'Select a location to manage notifications.'}
                action={
                  <button
                    type="button"
                    onClick={() => void handleSaveNotificationSettings()}
                    disabled={!selectedLocationId || savingNotificationSettings}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {savingNotificationSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                }
              >
                {!selectedLocationId ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    Select a location to manage notification settings.
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-start gap-3">
                        <div className={`rounded-2xl p-3 ${notificationEnabledDraft ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {notificationEnabledDraft ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
                        </div>
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900">Push alerts for low stock</h4>
                          <p className="mt-1 text-sm text-slate-500">
                            Turn delivery on or off without changing threshold rules.
                          </p>
                        </div>
                      </div>

                      <label className="mt-5 flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <div>
                          <div className="font-medium text-slate-900">Notification delivery</div>
                          <div className="text-sm text-slate-500">
                            {notificationEnabledDraft ? 'Enabled for this location.' : 'Disabled for this location.'}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={notificationEnabledDraft}
                          onChange={(event) => setNotificationEnabledDraft(event.target.checked)}
                          className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleCheckAndNotify(selectedLocation?.locationCode || '')}
                      disabled={!selectedLocation || sendingNotificationRun}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-4 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                    >
                      <BellRing className="h-4 w-4" />
                      {sendingNotificationRun ? 'Checking...' : 'Check This Location'}
                    </button>
                  </div>
                )}
              </SectionShell>

              <SectionShell
                title="Recent Notification Activity"
                description="History for the selected location."
                action={
                  <button
                    type="button"
                    onClick={() => void loadNotificationHistory()}
                    disabled={!selectedLocationId || notificationLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${notificationLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                }
              >
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-4 md:grid-cols-4">
                    <label className="text-sm font-medium text-slate-600">
                      Status
                      <select
                        value={notificationFilters.status}
                        onChange={(event) => setNotificationFilters((current) => ({ ...current, status: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                      >
                        {Object.entries(NOTIFICATION_STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm font-medium text-slate-600">
                      Date From
                      <input
                        type="date"
                        value={notificationFilters.dateFrom}
                        onChange={(event) => setNotificationFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                      />
                    </label>

                    <label className="text-sm font-medium text-slate-600">
                      Date To
                      <input
                        type="date"
                        value={notificationFilters.dateTo}
                        onChange={(event) => setNotificationFilters((current) => ({ ...current, dateTo: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                      />
                    </label>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void loadNotificationHistory()}
                        disabled={!selectedLocationId || notificationLoading}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        Apply Filters
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      Total Runs <span className="ml-2 font-semibold text-slate-900">{notificationSummary.total}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      Sent <span className="ml-2 font-semibold text-emerald-700">{notificationSummary.sent}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      Failed <span className="ml-2 font-semibold text-rose-700">{notificationSummary.failed}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      Product Count Sum <span className="ml-2 font-semibold text-slate-900">{notificationSummary.totalLowCount}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {notificationLoading ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                      Loading notification history...
                    </div>
                  ) : notificationRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                      No notification history for the current filters.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-3xl border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Time</th>
                            <th className="px-4 py-3 text-left font-semibold">Status</th>
                            <th className="px-4 py-3 text-left font-semibold">Products</th>
                            <th className="px-4 py-3 text-left font-semibold">Success / Fail</th>
                            <th className="px-4 py-3 text-left font-semibold">Trigger</th>
                            <th className="px-4 py-3 text-left font-semibold">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notificationRows.map((row) => (
                            <tr key={row.id} className="border-t border-slate-200 bg-white align-top">
                              <td className="px-4 py-3 text-slate-700">{formatGeneratedAt(row.notificationTime)}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                                  row.status === 'sent'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : row.status === 'failed'
                                      ? 'bg-rose-100 text-rose-700'
                                      : row.status === 'skipped'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-slate-200 text-slate-600'
                                }`}>
                                  {row.status || 'unknown'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{Number(row.lowCount || 0)}</td>
                              <td className="px-4 py-3 text-slate-700">{Number(row.successCount || 0)} / {Number(row.failureCount || 0)}</td>
                              <td className="px-4 py-3 text-slate-700">{row.trigger || 'manual'}</td>
                              <td className="px-4 py-3 text-slate-500">{row.reason || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </SectionShell>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LowStockTab;
