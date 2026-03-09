import React, { useCallback, useEffect, useState } from 'react';
import { Play, Square, Clock, Calendar, Activity, FileText, AlertCircle, CheckCircle, XCircle, Printer } from 'lucide-react';
import LogsTab from '../components/LogsTab';
import AnalysisTab from '../components/AnalysisTab';
import Toast from '../components/Toast';
import { cycleAPI } from '../service/api';
import CycleTab from '../components/CycleTab';
import PrinterTab from '../components/PrinterTab';
import LowStockTab from '../components/LowStockTab';

// Utility: Format date



// Tab Navigation Component
const TabNavigation = ({ activeTab, onTabChange, disabled = false }) => {
  const tabs = [
    { id: 'cycle', label: 'Cycle', icon: Activity },
    { id: 'analysis', label: 'Analysis', icon: FileText },
    { id: 'logs', label: 'Logs', icon: Clock },
    { id: 'printer', label: 'Printer', icon: Printer },
    { id: 'low', label: 'Low Stock', icon: AlertCircle },
  ];

  const isDisabled = disabled;

  return (
    <div className="flex gap-2 border-b border-gray-200">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isDisabled) {
                return;
              }
              onTabChange(tab.id);
            }}
            disabled={isDisabled}
            className={`flex items-center gap-2 px-6 py-3 font-medium transition-all ${
              isDisabled
                ? 'text-gray-400 cursor-not-allowed opacity-50'
                : activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

const isDashboardPath = () => {
  if (typeof window === 'undefined') return false;
  const pathname = String(window.location.pathname || '')
    .trim()
    .toLowerCase();
  return pathname === '/' || pathname === '/dashboard';
};






// Main App Component
export default function CycleManagementApp() {
  const getTabFromUrl = () => {
    if (typeof window === 'undefined') return 'cycle';
    const params = new URLSearchParams(window.location.search);
    const tab = String(params.get('tab') || '').trim().toLowerCase();
    return ['cycle', 'analysis', 'logs', 'printer', 'low'].includes(tab) ? tab : 'cycle';
  };

  const setTabInUrl = (tab) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (tab && tab !== 'cycle') {
      params.set('tab', tab);
    } else {
      params.delete('tab');
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(null, '', nextUrl);
  };

  const [activeTab, setActiveTab] = useState(getTabFromUrl);
  const [currentCycle, setCurrentCycle] = useState(null);
  const [allCycles, setAllCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [missingBarcodeInfo, setMissingBarcodeInfo] = useState({
    count: 0,
    products: [],
    metadata: null
  });
  const [missingBarcodeLoading, setMissingBarcodeLoading] = useState(false);
  const [missingBarcodeError, setMissingBarcodeError] = useState(null);
  const [showMissingBarcodeModal, setShowMissingBarcodeModal] = useState(false);
  const [nilStockInfo, setNilStockInfo] = useState({
    count: 0,
    products: [],
    metadata: null
  });
  const [nilStockLoading, setNilStockLoading] = useState(false);
  const [nilStockError, setNilStockError] = useState(null);
  const [showNilStockModal, setShowNilStockModal] = useState(false);
  // const [operators, setOperators] = useState([]);
  // const [selectedOperator, setSelectedOperator] = useState('');
  const selectedOperator = '';
  // const [brandsStatus, setBrandsStatus] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  const fetchCurrentCycle = useCallback(async () => {
    try {
      const result = await cycleAPI.getCurrentCycle();
      console.log("🚀 ~ fetchCurrentCycle ~ result:", result)
      if (result.success) {

        setCurrentCycle(result);
      }
    } catch (error) {
      console.error('Error fetching current cycle:', error);
    }
  }, []);

  const fetchAllCycles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await cycleAPI.getAllCycles();
      if (result.success) {
        setAllCycles(result.cycles || []);
      }
    } catch (error) {
      console.error('Error fetching all cycles:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMissingBarcodes = useCallback(async () => {
    setMissingBarcodeLoading(true);
    setMissingBarcodeError(null);
    try {
      const result = await cycleAPI.getMissingBarcodes();
      if (result.success) {
        setMissingBarcodeInfo({
          count:
            typeof result.count === 'number'
              ? result.count
              : result.products?.length || 0,
          products: result.products || [],
          metadata: result.metadata || null
        });
      } else {
        setMissingBarcodeError(
          result.message || 'Unable to load missing barcode data'
        );
      }
    } catch (error) {
      setMissingBarcodeError(
        error.message || 'Unable to load missing barcode data'
      );
    } finally {
      setMissingBarcodeLoading(false);
    }
  }, []);

  const fetchNilStock = useCallback(async () => {
    setNilStockLoading(true);
    setNilStockError(null);
    try {
      const result = await cycleAPI.getNilStock();
      if (result.success) {
        setNilStockInfo({
          count:
            typeof result.count === 'number'
              ? result.count
              : result.products?.length || 0,
          products: result.products || [],
          metadata: result.metadata || null
        });
      } else {
        setNilStockError(result.message || 'Unable to load nil stock data');
      }
    } catch (error) {
      setNilStockError(error.message || 'Unable to load nil stock data');
    } finally {
      setNilStockLoading(false);
    }
  }, []);
  // const fetchOperators = async () => {
  //   try {
  //     const result = await cycleAPI.getOperators();
  //     console.log('Operators API result:', result);
  //     if (result.success) {
  //       // Use operators array if available, otherwise extract from data
  //       if (result.operators && result.operators.length > 0) {
  //         setOperators(result.operators);
  //       } else if (result.data && result.data.length > 0) {
  //         // Extract operator names from CSV data
  //         const operatorNames = result.data
  //           .map(row => {
  //             // Try different possible column names
  //             return row.Name || row.NAME || row.name || row.Operator || row.OPERATOR || row.operator || row['Operator Name'] || row['OPERATOR NAME'] || Object.values(row)[0];
  //           })
  //           .filter(name => name && name.trim() !== '')
  //           .filter((name, index, self) => self.indexOf(name) === index); // Remove duplicates
  //         setOperators(operatorNames);
  //       } else {
  //         console.warn('No operators found in response');
  //         setOperators([]);
  //       }
  //     } else {
  //       console.error('Failed to fetch operators:', result.message);
  //       showToast(result.message || 'Failed to load operators', 'error');
  //     }
  //   } catch (error) {
  //     console.error('Error fetching operators:', error);
  //     showToast('Failed to load operators: ' + error.message, 'error');
  //   }
  // };

  // const fetchBrandsStatus = async () => {
  //   try {
  //     const result = await cycleAPI.getBrandsStatus();
  //     if (result.success) {
  //       setBrandsStatus(result);
  //     }
  //   } catch (error) {
  //     console.error('Error fetching brands status:', error);
  //     showToast('Failed to check brands.csv status', 'error');
  //   }
  // };

  const refreshData = useCallback(() => {
    fetchCurrentCycle();
    fetchAllCycles();
    fetchMissingBarcodes();
    fetchNilStock();
    // fetchBrandsStatus();
  }, [fetchAllCycles, fetchCurrentCycle, fetchMissingBarcodes, fetchNilStock]);

  const triggerDashboardRefresh = useCallback(() => {
    if (!isDashboardPath()) return;
    refreshData();
  }, [refreshData]);

  const closeMissingBarcodeModal = useCallback(() => {
    setShowMissingBarcodeModal(false);
    triggerDashboardRefresh();
  }, [triggerDashboardRefresh]);

  const closeNilStockModal = useCallback(() => {
    setShowNilStockModal(false);
    triggerDashboardRefresh();
  }, [triggerDashboardRefresh]);

  useEffect(() => {
    // fetchOperators();
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setActiveTab(getTabFromUrl());
      triggerDashboardRefresh();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [triggerDashboardRefresh]);

  useEffect(() => {
    setTabInUrl(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerDashboardRefresh();
      }
    };
    const handleFocus = () => {
      triggerDashboardRefresh();
    };
    const handlePageShow = () => {
      triggerDashboardRefresh();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerDashboardRefresh]);

  // Check brands status periodically
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     fetchBrandsStatus();
  //   }, 60000); // Check every minute
  //   return () => clearInterval(interval);
  // }, []);

  return (
    <div className="min-h-screen w-full bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b w-full">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Cycle Management</h1>
              <p className="text-sm text-gray-600 mt-1">Track and manage inventory cycles</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Operator dropdown logic is paused for now */}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                {new Date().toLocaleDateString('en-IN', { 
                  day: '2-digit', 
                  month: 'short', 
                  year: 'numeric' 
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div
              className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 rounded-lg border ${
                missingBarcodeInfo.count > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-green-50 border-green-200 text-green-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className={`w-5 h-5 flex-shrink-0 ${
                    missingBarcodeInfo.count > 0
                      ? 'text-amber-500'
                      : 'text-green-500'
                  }`}
                />
                <div>
                  <p className="font-semibold">
                    {missingBarcodeLoading
                      ? 'Checking barcode coverage...'
                      : missingBarcodeError
                        ? 'Unable to load missing barcode info'
                        : missingBarcodeInfo.count > 0
                          ? `${missingBarcodeInfo.count} products are missing BarCode values`
                          : 'All products in brands.csv include a BarCode'}
                  </p>
                  <p className="text-sm mt-1">
                    {missingBarcodeError
                      ? 'Please retry – the information comes from brands.csv.'
                      : missingBarcodeInfo.count > 0
                        ? 'Update brands.csv so scanning can locate every product.'
                        : 'No action required at this time.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchMissingBarcodes}
                  disabled={missingBarcodeLoading}
                  className="px-3 py-2 text-sm border rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {missingBarcodeLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={() => setShowMissingBarcodeModal(true)}
                  disabled={
                    missingBarcodeLoading ||
                    missingBarcodeInfo.count === 0 ||
                    !!missingBarcodeError
                  }
                  className={`px-4 py-2 text-sm font-semibold rounded-md border ${
                    missingBarcodeInfo.count > 0 && !missingBarcodeError
                      ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600'
                      : 'bg-white border-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  View list
                </button>
              </div>
            </div>

            <div
              className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 rounded-lg border ${
                nilStockInfo.count > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-green-50 border-green-200 text-green-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className={`w-5 h-5 flex-shrink-0 ${
                    nilStockInfo.count > 0
                      ? 'text-amber-500'
                      : 'text-green-500'
                  }`}
                />
                <div>
                  <p className="font-semibold">
                    {nilStockLoading
                      ? 'Checking nil stock list...'
                      : nilStockError
                        ? 'Unable to load nil stock info'
                        : nilStockInfo.count > 0
                          ? `${nilStockInfo.count} products have nil shop stock`
                          : 'No nil stock items found'}
                  </p>
                  <p className="text-sm mt-1">
                    {nilStockError
                      ? 'Please retry – the information comes from brands.csv.'
                      : nilStockInfo.count > 0
                        ? 'Items with stock in godown but zero in shop.'
                        : 'No action required at this time.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchNilStock}
                  disabled={nilStockLoading}
                  className="px-3 py-2 text-sm border rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {nilStockLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={() => setShowNilStockModal(true)}
                  disabled={
                    nilStockLoading ||
                    nilStockInfo.count === 0 ||
                    !!nilStockError
                  }
                  className={`px-4 py-2 text-sm font-semibold rounded-md border ${
                    nilStockInfo.count > 0 && !nilStockError
                      ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600'
                      : 'bg-white border-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  View list
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-6">
        {/* brandsStatus + operator warnings are paused for now */}

        <div className="bg-white rounded-lg shadow-md overflow-hidden w-full">
          <TabNavigation 
            activeTab={activeTab} 
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (tab === 'cycle') {
                triggerDashboardRefresh();
              }
            }}
            disabled={false}
          />
          
          <div className="min-h-[500px]">
            <>
              {activeTab === 'cycle' && (
                <CycleTab 
                  currentCycle={currentCycle} 
                  onRefresh={refreshData}
                  showToast={showToast}
                  selectedOperator={selectedOperator}
                />
              )}
              {activeTab === 'analysis' && <AnalysisTab selectedOperator={selectedOperator} />}
              {activeTab === 'logs' && (
                <LogsTab 
                  allCycles={allCycles} 
                  loading={loading}
                  onRefresh={refreshData}
                  selectedOperator={selectedOperator}
                />
              )}
              {activeTab === 'printer' && (
                <PrinterTab
                  allCycles={allCycles}
                  onRefresh={refreshData}
                  showToast={showToast}
                  selectedOperator={selectedOperator}
                />
              )}
              {activeTab === 'low' && (
                <LowStockTab
                  onRefresh={refreshData}
                  showToast={showToast}
                />
              )}
            </>
          </div>
        </div>
      </main>

      {showMissingBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Products Missing BarCode
                </h2>
                <p className="text-sm text-gray-500">
                  {missingBarcodeInfo.metadata?.title
                    ? `${missingBarcodeInfo.metadata.title} • `
                    : ''}
                  {missingBarcodeInfo.metadata?.date || 'brands.csv'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Total records without BarCode: {missingBarcodeInfo.count}
                </p>
              </div>
              <button
                onClick={closeMissingBarcodeModal}
                className="text-gray-500 hover:text-gray-800 font-semibold"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {missingBarcodeInfo.count === 0 ? (
                <p className="text-sm text-gray-600">
                  All products currently include BarCode values.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left border">
                    <thead className="bg-gray-50">
                      <tr className="text-gray-500 uppercase tracking-wide text-xs">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Brand</th>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3">Pack (ml)</th>
                        <th className="py-2 px-3">BPC</th>
                        <th className="py-2 px-3">MRP</th>
                        <th className="py-2 px-3">Godown</th>
                        <th className="py-2 px-3">Shop</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingBarcodeInfo.products.map((product, index) => (
                        <tr
                          key={`${product.Brand || 'brand'}-${
                            product.Pack || 'pack'
                          }-${index}`}
                          className="border-t"
                        >
                          <td className="py-2 px-3 text-gray-500">
                            {product['Sl.'] || product.Sl || index + 1}
                          </td>
                          <td className="py-2 px-3 font-semibold text-gray-900">
                            {product.Brand || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.Item || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.Pack || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.BPC || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.MRP || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.Godown || product.GODOWN || '0'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.Shop || product.SHOP || '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNilStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Nil Stock (Shop)
                </h2>
                <p className="text-sm text-gray-500">
                  {nilStockInfo.metadata?.title
                    ? `${nilStockInfo.metadata.title} • `
                    : ''}
                  {nilStockInfo.metadata?.date || 'brands.csv'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Total nil stock records: {nilStockInfo.count}
                </p>
              </div>
              <button
                onClick={closeNilStockModal}
                className="text-gray-500 hover:text-gray-800 font-semibold"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {nilStockInfo.count === 0 ? (
                <p className="text-sm text-gray-600">
                  No nil stock items found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left border">
                    <thead className="bg-gray-50">
                      <tr className="text-gray-500 uppercase tracking-wide text-xs">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Brand</th>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3">Pack (ml)</th>
                        <th className="py-2 px-3">BPC</th>
                        <th className="py-2 px-3">MRP</th>
                        <th className="py-2 px-3">Godown</th>
                        <th className="py-2 px-3">Shop</th>
                        <th className="py-2 px-3">BarCode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nilStockInfo.products.map((product, index) => (
                        <tr
                          key={`${product.brand || 'brand'}-${product.pack || 'pack'}-${index}`}
                          className="border-t"
                        >
                          <td className="py-2 px-3 text-gray-500">
                            {index + 1}
                          </td>
                          <td className="py-2 px-3 font-semibold text-gray-900">
                            {product.brand || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.item || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.pack || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.bpc || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.mrp || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.godown?.formatted || '0.000'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.shop?.formatted || '0.000'}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {product.barcode || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
