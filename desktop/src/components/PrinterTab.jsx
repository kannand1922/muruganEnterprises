import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Printer as PrinterIcon, RefreshCw } from 'lucide-react';
import { cycleAPI } from '../service/api';
import { formatDate } from '../helpers';

const LOCATION_OPTIONS = [
  { id: 'shop', label: 'Shop' },
  { id: 'godown', label: 'Godown' },
];

const PrinterTab = ({ allCycles, onRefresh, showToast }) => {
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [location, setLocation] = useState('shop');
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [printing, setPrinting] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const orderedCycles = useMemo(() => {
    if (!Array.isArray(allCycles)) return [];
    return [...allCycles].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
  }, [allCycles]);

  useEffect(() => {
    if (orderedCycles.length === 0) {
      setSelectedCycle(null);
      return;
    }
    setSelectedCycle((prev) => {
      if (prev) {
        const stillExists = orderedCycles.find((cycle) => cycle.sno === prev.sno);
        if (stillExists) {
          return stillExists;
        }
      }
      const active = orderedCycles.find((cycle) => cycle.status === 'active');
      return active || orderedCycles[0];
    });
  }, [orderedCycles]);

  useEffect(() => {
    const loadPrinters = async () => {
      try {
        const result = await cycleAPI.getPrinters();
        const list = Array.isArray(result?.data) ? result.data : [];
        setPrinters(list);
        if (list.length > 0 && !selectedPrinter) {
          setSelectedPrinter(list[0]?.IP || '');
        }
      } catch (error) {
        console.error('Failed to load printers', error);
        showToast?.('Unable to load printer list', 'error');
      }
    };

    loadPrinters();
  }, [selectedPrinter, showToast]);

  const cycleDate = selectedCycle?.startDate || '';
  const locationLabel =
    LOCATION_OPTIONS.find((option) => option.id === location)?.label || 'Shop';

  const loadPreview = useCallback(async () => {
    if (!cycleDate) {
      setPreviewError('Select a cycle to preview.');
      setPreviewHtml('');
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await cycleAPI.previewVerificationReport({
        cycleDate,
        location,
      });
      if (!response?.success) {
        throw new Error(response?.message || 'Unable to load preview');
      }
      setPreviewHtml(response.html || '');
    } catch (error) {
      console.error('Preview failed', error);
      setPreviewError(error.message || 'Unable to load preview');
      setPreviewHtml('');
    } finally {
      setPreviewLoading(false);
    }
  }, [cycleDate, location]);

  useEffect(() => {
    if (previewOpen) {
      loadPreview();
    }
  }, [loadPreview, previewOpen]);

  const handlePrint = async () => {
    if (!cycleDate) {
      showToast?.('Select a cycle before printing', 'warning');
      return;
    }
    if (!selectedPrinter) {
      showToast?.('Select a printer before printing', 'warning');
      return;
    }

    setPrinting(true);
    try {
      const response = await cycleAPI.printVerificationReport({
        cycleDate,
        location,
        printerIP: selectedPrinter,
      });
      if (!response?.success) {
        throw new Error(response?.message || 'Print failed');
      }
      showToast?.('Print successful!', 'success');
      setShowPrintModal(false);
    } catch (error) {
      console.error('Print error:', error);
      showToast?.(error.message || 'Error sending print job', 'error');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="w-full p-6 space-y-6">
      <div className="sticky top-0 z-10 bg-gray-100 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Verification Print
            </h2>
            <p className="text-sm text-gray-600">
              {cycleDate
                ? `Cycle date: ${formatDate(cycleDate)} · Location: ${locationLabel}`
                : 'Select a cycle to print'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onRefresh?.()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh data
            </button>
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!cycleDate}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border ${
                cycleDate
                  ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'border-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setShowPrintModal(true)}
              disabled={!cycleDate}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white ${
                cycleDate
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
            >
              <PrinterIcon className="w-4 h-4" />
              Print report
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-semibold text-gray-600">Cycle</label>
            <select
              value={selectedCycle ? String(selectedCycle.sno) : ''}
              onChange={(event) => {
                const { value } = event.target;
                const next = orderedCycles.find((cycle) => String(cycle.sno) === value);
                setSelectedCycle(next || null);
              }}
              className="w-full mt-1 rounded-lg border border-gray-200 px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              {orderedCycles.map((cycle) => (
                <option key={cycle.sno} value={String(cycle.sno)}>
                  {`#${cycle.sno} • ${cycle.startDate}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-600">Location</label>
            <div className="flex gap-2 mt-1">
              {LOCATION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setLocation(option.id)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                    location === option.id
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 text-gray-600 hover:border-blue-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          {selectedPrinter
            ? `Selected printer: ${selectedPrinter}`
            : 'No printer selected. Choose one when you print.'}
        </div>
      </div>

      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Print Verification Report
                </h2>
                <p className="text-sm text-gray-500">
                  Cycle date: {cycleDate || '—'}
                </p>
                <p className="text-sm text-gray-500">
                  Location: {locationLabel}
                </p>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-gray-500 hover:text-gray-800 font-semibold"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">
                  Generated: {new Date().toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Available Printers
                </h3>
                {printers.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No printers available.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {printers.map((printer, index) => (
                      <label
                        key={`${printer.IP || printer['PRINTER NAME'] || index}-${index}`}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${
                          selectedPrinter === printer.IP
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="printer"
                          value={printer.IP}
                          checked={selectedPrinter === printer.IP}
                          onChange={() => setSelectedPrinter(printer.IP)}
                        />
                        <div>
                          <p className="text-sm font-semibold text-gray-800">
                            {printer['PRINTER NAME'] || 'Printer'}
                          </p>
                          <p className="text-xs text-gray-500">IP: {printer.IP}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t p-4 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePrint}
                disabled={!selectedPrinter || printing}
                className={`px-4 py-2 text-sm font-semibold rounded-md text-white ${
                  !selectedPrinter || printing
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {printing ? 'Printing...' : 'Print Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 px-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Print Preview</h2>
                <p className="text-sm text-gray-500">
                  {cycleDate ? `Cycle date: ${cycleDate}` : 'No cycle selected'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadPreview}
                  disabled={previewLoading}
                  className="px-3 py-2 text-sm font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {previewLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="text-gray-500 hover:text-gray-800 font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              {previewLoading ? (
                <div className="text-center text-gray-500 py-10">
                  Loading preview...
                </div>
              ) : previewError ? (
                <div className="text-center text-red-600 py-10">
                  {previewError}
                </div>
              ) : previewHtml ? (
                <div className="flex justify-center">
                  <iframe
                    title="Print preview"
                    className="w-[340px] h-[70vh] border border-gray-200 rounded-lg bg-white"
                    srcDoc={previewHtml}
                  />
                </div>
              ) : (
                <div className="text-center text-gray-500 py-10">
                  Preview unavailable.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrinterTab;
