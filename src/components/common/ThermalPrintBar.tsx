import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Printer,
  RefreshCw,
  Settings2,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { findSuggestedPrinter, type useQzThermalPrinter } from '@/services/qzService';

interface ThermalPrintBarProps {
  qz: ReturnType<typeof useQzThermalPrinter>;
  onClose: () => void;
  whatsappAction?: ReactNode;
  onDownloadPdf?: () => void;
}

export function ThermalPrintBar({
  qz,
  onClose,
  whatsappAction,
  onDownloadPdf,
}: ThermalPrintBarProps) {
  const [selectedPrinter, setSelectedPrinter] = useState<string>(qz.confirmedPrinter || '');
  const { showConfig, availablePrinters, isLoadingPrinters, refreshPrinters, confirmedPrinter } = qz;

  // Sync selected printer whenever confirmedPrinter changes
  useEffect(() => {
    if (confirmedPrinter) {
      setSelectedPrinter(confirmedPrinter);
    }
  }, [confirmedPrinter]);

  // Auto-scan printers when config opens
  useEffect(() => {
    if (showConfig && availablePrinters.length === 0 && !isLoadingPrinters) {
      void refreshPrinters().then((printers) => {
        if (!selectedPrinter || !printers.includes(selectedPrinter)) {
          const suggested = findSuggestedPrinter(printers);
          if (suggested) {
            setSelectedPrinter(suggested);
          } else if (printers.length > 0) {
            setSelectedPrinter(printers[0]);
          }
        }
      });
    }
  }, [showConfig, availablePrinters.length, isLoadingPrinters, refreshPrinters, selectedPrinter]);

  return (
    <div className="space-y-3">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-cream-100 rounded-xl p-3 border border-cream-200">
        {/* Status indicator on the left */}
        <div className="flex items-center gap-2 text-xs">
          {qz.confirmedPrinter ? (
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-leaf-200">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  qz.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
                title={qz.isConnected ? 'QZ Tray Connected' : 'Checking QZ Tray...'}
              />
              <span className="text-stone-600 font-medium">TVS Printer:</span>
              <span className="font-bold text-leaf-900 max-w-[130px] sm:max-w-[180px] truncate">
                {qz.confirmedPrinter}
              </span>
              <button
                type="button"
                onClick={() => qz.setShowConfig(!qz.showConfig)}
                className="text-leaf-700 hover:text-leaf-950 underline font-semibold ml-1 text-[11px]"
                title="Change or reconfigure printer"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-50 text-amber-900 px-2.5 py-1 rounded-lg border border-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
              <span className="font-bold">No Printer Confirmed</span>
              <button
                type="button"
                onClick={() => qz.setShowConfig(true)}
                className="underline font-bold text-amber-800 hover:text-amber-950 ml-1"
              >
                Set Up
              </button>
            </div>
          )}
        </div>

        {/* Buttons on the right */}
        <div className="flex flex-wrap items-center gap-2">
          {whatsappAction}

          {onDownloadPdf && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={onDownloadPdf}
              title="Download official bill receipt as PDF"
            >
              Download PDF
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={X}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          >
            Close
          </Button>

          {/* Manual Browser Print button (Always available as safe manual fallback) */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Printer}
            onClick={qz.printBrowser}
            title="Manual print using standard browser print dialog"
          >
            Browser Print
          </Button>

          {/* Direct Thermal Print via QZ Tray */}
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={qz.isPrinting ? Loader2 : qz.printSuccess ? Check : Zap}
            disabled={qz.isPrinting}
            onClick={() => void qz.printDirect()}
            className="!bg-leaf-700 hover:!bg-leaf-800 text-white shadow-sm"
            title="Direct print to TVS RP 3200 Lite thermal printer"
          >
            {qz.isPrinting
              ? 'Printing…'
              : qz.printSuccess
              ? 'Printed (Print Again)'
              : 'Direct Print (TVS)'}
          </Button>
        </div>
      </div>

      {/* Error Banner when QZ Tray is not running or print failed */}
      {qz.error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 shadow-sm animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="font-bold text-red-950">QZ Tray Direct Print Issue</p>
              <p className="text-red-800 leading-relaxed">{qz.error}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void qz.printDirect()}
                  className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg transition-colors"
                >
                  Retry Direct Print
                </button>
                <button
                  type="button"
                  onClick={() => {
                    qz.setError(null);
                    qz.printBrowser();
                  }}
                  className="px-3 py-1 bg-white hover:bg-red-100 border border-red-300 text-red-900 font-bold rounded-lg transition-colors"
                >
                  Use Browser Print Instead
                </button>
                <button
                  type="button"
                  onClick={() => qz.setShowConfig(true)}
                  className="px-3 py-1 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 font-bold rounded-lg transition-colors"
                >
                  Check Printer Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printer Selection & Confirmation Panel */}
      {qz.showConfig && (
        <div className="rounded-xl border-2 border-leaf-300 bg-emerald-50/60 p-4 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-leaf-900 font-bold text-sm">
              <Settings2 className="h-4 w-4 text-leaf-700" />
              <span>Select &amp; Confirm Thermal Printer</span>
            </div>
            {qz.confirmedPrinter && (
              <button
                type="button"
                onClick={() => qz.setShowConfig(false)}
                className="text-stone-500 hover:text-stone-800 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <p className="text-stone-600 leading-relaxed">
            Direct printing requires selecting your <strong>TVS RP 3200 Lite</strong> (80mm) thermal printer.
            Once confirmed, KBN Fruits and Traders will remember this printer for direct, one-click receipts.
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="flex-1 rounded-lg border-2 border-leaf-300 bg-white px-3 py-2 text-sm font-semibold text-leaf-950 focus:border-leaf-600 focus:outline-none"
                disabled={qz.isLoadingPrinters}
              >
                <option value="">-- Choose a Printer --</option>
                {qz.availablePrinters.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  void qz.refreshPrinters().then((printers) => {
                    if (printers && printers.length > 0) {
                      if (!selectedPrinter || !printers.includes(selectedPrinter)) {
                        const suggested = findSuggestedPrinter(printers);
                        setSelectedPrinter(suggested || printers[0]);
                      }
                    }
                  });
                }}
                disabled={qz.isLoadingPrinters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-leaf-300 bg-white px-3 py-2 text-xs font-bold text-leaf-800 hover:bg-leaf-50 disabled:opacity-50"
                title="Scan printers via QZ Tray"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${qz.isLoadingPrinters ? 'animate-spin' : ''}`} />
                {qz.isLoadingPrinters ? 'Scanning…' : 'Scan'}
              </button>
            </div>

            {qz.availablePrinters.length === 0 && !qz.isLoadingPrinters && (
              <p className="text-amber-700 font-medium">
                No printers found yet. Ensure QZ Tray is running on this PC and click &ldquo;Scan&rdquo;.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={!selectedPrinter || qz.isLoadingPrinters}
                onClick={() => {
                  if (selectedPrinter) {
                    qz.confirmPrinter(selectedPrinter);
                  }
                }}
                className="px-4 py-2 bg-leaf-700 hover:bg-leaf-800 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-sm"
              >
                Confirm &amp; Remember This Printer
              </button>

              {qz.confirmedPrinter && (
                <button
                  type="button"
                  onClick={() => qz.setShowConfig(false)}
                  className="px-3 py-2 bg-white border border-stone-300 text-stone-700 font-bold rounded-lg text-xs hover:bg-stone-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
