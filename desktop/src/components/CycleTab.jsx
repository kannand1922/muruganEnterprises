import { useState, useEffect } from "react";
import { calculateDuration, formatDate } from "../helpers";
import { cycleAPI } from "../service/api";
import { Play, Square, ShieldAlert, LockKeyhole } from "lucide-react";

// Cycle Tab Component
const CycleTab = ({ currentCycle, onRefresh, showToast }) => {
    console.log("🚀 ~ CycleTab ~ currentCycle:", currentCycle)
    const [loading, setLoading] = useState(false);
    const [showStopConfirm, setShowStopConfirm] = useState(false);
    const [customEndDate, setCustomEndDate] = useState('');
    const [stopValidation, setStopValidation] = useState({
      checking: false,
      canStop: false,
      message: '',
      issues: [],
      totalIssues: 0,
    });
    const [showForcePrompt, setShowForcePrompt] = useState(false);
    const [forcePassword, setForcePassword] = useState('');
    const [forceError, setForceError] = useState('');
  
    const resetStopValidation = () => {
      setStopValidation({
        checking: true,
        canStop: false,
        message: 'Checking shop stock matches…',
        issues: [],
        totalIssues: 0,
      });
      setShowForcePrompt(false);
      setForcePassword('');
      setForceError('');
    };
  
    const mapIssues = (result) => {
      const unmatchedIssues = (result?.unmatched || []).map((item) => ({
        brand: item.brand,
        pack: item.pack,
        detail:
          item?.difference && typeof item.difference.total === 'number'
            ? `Diff ${item.difference.sign || ''}${Math.abs(item.difference.total)}`
            : 'Stock difference detected',
      }));
      const nonScannedIssues = (result?.nonScanned || []).map((item) => ({
        brand: item.brand,
        pack: item.pack,
        detail: 'Not scanned in shop',
      }));
      return [...unmatchedIssues, ...nonScannedIssues];
    };
  
    const checkCycleMatches = async () => {
      if (!currentCycle?.startDate) {
        setStopValidation({
          checking: false,
          canStop: false,
          message: 'Unable to determine active cycle date.',
          issues: [],
          totalIssues: 0,
        });
        return;
      }
  
      setStopValidation({
        checking: true,
        canStop: false,
        message: 'Checking shop stock matches…',
        issues: [],
        totalIssues: 0,
      });
      try {
        const result = await cycleAPI.compareCycle(currentCycle.startDate, 'shop');
        if (!result.success) {
          throw new Error(result.message || 'Comparison failed');
        }
        const issues = mapIssues(result);
        const canStop = issues.length === 0;
        setStopValidation({
          checking: false,
          canStop,
          message: canStop
            ? 'All shop stocks are matched. You can safely stop the cycle.'
            : 'Shop stock mismatches detected. Resolve them or use Force Close with admin approval.',
          issues: issues.slice(0, 5),
          totalIssues: issues.length,
        });
      } catch (error) {
        console.error('Error validating shop stock:', error);
        setStopValidation({
          checking: false,
          canStop: false,
          message: 'Unable to verify matches. Only force close is available.',
          issues: [],
          totalIssues: 0,
        });
      }
    };
  
    useEffect(() => {
      if (showStopConfirm) {
        resetStopValidation();
        checkCycleMatches();
      } else {
        setShowForcePrompt(false);
        setForcePassword('');
        setForceError('');
      }
    }, [showStopConfirm, currentCycle?.startDate]);
  
    const handleStartCycle = async () => {
      setLoading(true);
      try {
        const result = await cycleAPI.startCycle();
        if (result.success) {
          showToast('Cycle started successfully!', 'success');
          onRefresh();
        } else {
          showToast(result.message || 'Failed to start cycle', 'error');
        }
      } catch (error) {
        console.error('Error starting cycle:', error);
        showToast('Error starting cycle', 'error');
      } finally {
        setLoading(false);
      }
    };
  
    const handleStopCycle = async (force = false, password = '') => {
      if (force && !password.trim()) {
        setForceError('Password is required to force close the cycle.');
        return;
      }

      setLoading(true);
      try {
        const result = await cycleAPI.stopCycle(
          customEndDate || null,
          force ? password : ''
        );
        if (result.success) {
          showToast(
            force ? 'Cycle force closed successfully!' : 'Cycle stopped successfully!',
            'success'
          );
          setShowStopConfirm(false);
          setCustomEndDate('');
          setShowForcePrompt(false);
          setForcePassword('');
          setForceError('');
          onRefresh();
        } else {
          if (result.requiresForcePassword && !force) {
            const pendingIssues = (result.pendingMatches || []).map((item) => ({
              brand: item.brand,
              pack: item.pack,
              detail:
                typeof item.difference === 'number'
                  ? `Diff ${item.difference > 0 ? '+' : ''}${item.difference}`
                  : item.masterExists === false
                  ? 'Brand missing in master file'
                  : 'Mismatch detected',
            }));
            setStopValidation({
              checking: false,
              canStop: false,
              message: result.message || 'Pending mismatches detected. Resolve or force close.',
              issues: pendingIssues.slice(0, 5),
              totalIssues: pendingIssues.length,
            });
            showToast(
              result.message || 'Cannot stop cycle until mismatches are resolved',
              'error'
            );
          } else {
            showToast(result.message || 'Failed to stop cycle', 'error');
          }
        }
      } catch (error) {
        console.error('Error stopping cycle:', error);
        showToast('Error stopping cycle', 'error');
      } finally {
        setLoading(false);
      }
    };
  
    const isActive = currentCycle?.active;
  
    return (
      <div className="w-full p-6 space-y-6">
        {/* Current Status Card */}
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Current Cycle Status</h2>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  isActive 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {isActive ? '● Active' : '○ No Active Cycle'}
                </span>
              </div>
            </div>
            
            {isActive && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Started</p>
                <p className="text-lg font-bold text-gray-800">
                  {formatDate(currentCycle.startDate)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {calculateDuration(currentCycle.startDate, null)}
                </p>
              </div>
            )}
          </div>
        </div>
  
        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={handleStartCycle}
            disabled={loading || isActive}
            className={`flex items-center justify-center gap-3 p-6 rounded-lg font-semibold text-lg transition-all ${
              isActive || loading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600 shadow-lg hover:shadow-xl'
            }`}
          >
            <Play className="w-6 h-6" />
            Start New Cycle
          </button>
  
          <button
            onClick={() => setShowStopConfirm(true)}
            disabled={loading || !isActive}
            className={`flex items-center justify-center gap-3 p-6 rounded-lg font-semibold text-lg transition-all ${
              !isActive || loading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-red-500 text-white hover:bg-red-600 shadow-lg hover:shadow-xl'
            }`}
          >
            <Square className="w-6 h-6" />
            Stop Current Cycle
          </button>
        </div>
  
        {/* Stop Confirmation Modal */}
        {showStopConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Stop Cycle</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to stop the current cycle?
              </p>
              <div className="mb-4 space-y-3">
                <div
                  className={`p-3 rounded-lg border text-sm ${
                    stopValidation.canStop
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    {stopValidation.canStop ? (
                      <Play className="w-4 h-4" />
                    ) : (
                      <ShieldAlert className="w-4 h-4" />
                    )}
                    <span>{stopValidation.canStop ? 'Ready to stop' : 'Pending actions required'}</span>
                  </div>
                  <p>{stopValidation.message}</p>
                  {!stopValidation.canStop && (
                    <button
                      className="mt-2 text-xs text-blue-600 hover:underline"
                      type="button"
                      onClick={checkCycleMatches}
                      disabled={stopValidation.checking}
                    >
                      {stopValidation.checking ? 'Checking…' : 'Re-check stock matches'}
                    </button>
                  )}
                </div>
  
                {!stopValidation.canStop && stopValidation.issues.length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      Pending items ({stopValidation.totalIssues})
                    </p>
                    <ul className="space-y-1 text-sm text-gray-600">
                      {stopValidation.issues.map((issue, idx) => (
                        <li key={`${issue.brand}-${issue.pack}-${idx}`} className="flex justify-between gap-3">
                          <span className="font-medium truncate">
                            {issue.brand} ({issue.pack})
                          </span>
                          <span className="text-right text-xs text-gray-500">
                            {issue.detail}
                          </span>
                        </li>
                      ))}
                      {stopValidation.totalIssues > stopValidation.issues.length && (
                        <li className="text-xs text-gray-500 italic">
                          +{stopValidation.totalIssues - stopValidation.issues.length} more items
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
  
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowStopConfirm(false);
                    setCustomEndDate('');
                    setShowForcePrompt(false);
                    setForcePassword('');
                    setForceError('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowForcePrompt(true)}
                  disabled={stopValidation.canStop || stopValidation.checking || loading}
                  className={`flex-1 px-4 py-2 rounded-lg border ${
                    stopValidation.canStop || stopValidation.checking
                      ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'border-amber-500 text-amber-600 hover:bg-amber-50'
                  }`}
                  type="button"
                >
                  Force Close
                </button>
                <button
                  onClick={() => handleStopCycle(false)}
                  disabled={
                    loading || stopValidation.checking || !stopValidation.canStop
                  }
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  {loading ? 'Stopping...' : 'Stop Cycle'}
                </button>
              </div>

              {showForcePrompt && (
                <div className="mt-4 border border-amber-200 rounded-lg p-4 bg-amber-50">
                  <div className="flex items-center gap-2 text-amber-800 font-semibold mb-2">
                    <LockKeyhole className="w-5 h-5" />
                    <span>Force Close Authorization</span>
                  </div>
                  <p className="text-sm text-amber-800 mb-3">
                    Enter the admin password to force close the cycle despite pending mismatches.
                  </p>
                  <input
                    type="password"
                    value={forcePassword}
                    onChange={(e) => {
                      setForcePassword(e.target.value);
                      setForceError('');
                    }}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Admin password"
                  />
                  {forceError && (
                    <p className="text-sm text-red-600 mt-1">{forceError}</p>
                  )}
                  <div className="flex gap-3 mt-3">
                    <button
                      onClick={() => {
                        setShowForcePrompt(false);
                        setForcePassword('');
                        setForceError('');
                      }}
                      className="flex-1 px-4 py-2 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleStopCycle(true, forcePassword)}
                      disabled={loading || !forcePassword.trim()}
                      className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                    >
                      {loading ? 'Closing...' : 'Force Close'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
  

      </div>
    );
  };

  export default CycleTab
