import { useCallback, useEffect, useState } from 'react';
import qz from 'qz-tray';

const CONFIRMED_PRINTER_KEY = 'kbn_confirmed_qz_printer';

export interface QzPrintResult {
  success: boolean;
  errorCode?: 'NOT_CONNECTED' | 'NO_CONFIRMED_PRINTER' | 'PRINT_FAILED' | 'BUSY';
  error?: string;
}

let isConnectingPromise: Promise<void> | null = null;
let isPrintJobRunning = false;

/**
 * Configure secure production certificate and signing function if available.
 * 
 * IMPORTANT SECURITY NOTICE:
 * - Public X.509 certificate can be retrieved from public assets or backend.
 * - Digital signature MUST be generated on a secure server/edge function where the private key is held.
 * - NEVER embed the private .pem or .key file in the client-side JavaScript.
 */
export function initQzSecurity(options?: {
  certificateUrl?: string;
  signatureEndpoint?: string;
}): void {
  if (!options) return;

  if (options.certificateUrl) {
    qz.security.setCertificatePromise((resolve, reject) => {
      fetch(options.certificateUrl!)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch certificate: ${res.statusText}`);
          return res.text();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  if (options.signatureEndpoint) {
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise((toSign: string) => {
      return (resolve, reject) => {
        fetch(options.signatureEndpoint!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: toSign }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`Signature endpoint error: ${res.statusText}`);
            return res.text();
          })
          .then(resolve)
          .catch(reject);
      };
    });
  }
}

/**
 * Check if the WebSocket connection to QZ Tray is active.
 */
export function isQzActive(): boolean {
  try {
    return qz.websocket.isActive();
  } catch {
    return false;
  }
}

/**
 * Connect to QZ Tray WebSocket on localhost.
 * Idempotent: returns existing connection if already active.
 */
export async function connectQz(retries = 1): Promise<void> {
  if (isQzActive()) {
    return;
  }

  if (isConnectingPromise) {
    return isConnectingPromise;
  }

  isConnectingPromise = (async () => {
    try {
      await qz.websocket.connect({
        retries,
        delay: 1,
      });
    } finally {
      isConnectingPromise = null;
    }
  })();

  return isConnectingPromise;
}

/**
 * Disconnect from QZ Tray WebSocket.
 */
export async function disconnectQz(): Promise<void> {
  if (isQzActive()) {
    try {
      await qz.websocket.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Retrieve the user-confirmed printer name from localStorage.
 * Does NOT guess or auto-fallback to an unconfirmed printer.
 */
export function getConfirmedPrinter(): string | null {
  try {
    return localStorage.getItem(CONFIRMED_PRINTER_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Save the user-selected printer as confirmed.
 */
export function setConfirmedPrinter(printerName: string): void {
  try {
    localStorage.setItem(CONFIRMED_PRINTER_KEY, printerName.trim());
  } catch (err) {
    console.warn('Failed to save confirmed printer to localStorage', err);
  }
}

/**
 * Remove confirmed printer from localStorage.
 */
export function clearConfirmedPrinter(): void {
  try {
    localStorage.removeItem(CONFIRMED_PRINTER_KEY);
  } catch (err) {
    console.warn('Failed to clear confirmed printer from localStorage', err);
  }
}

/**
 * Get the list of all available printers from QZ Tray using qz.printers.find().
 * When query is omitted, QZ Tray returns an array of all installed printer names.
 */
export async function listAvailablePrinters(): Promise<string[]> {
  await connectQz();
  const printers = await qz.printers.find();
  if (Array.isArray(printers)) {
    return printers;
  }
  if (typeof printers === 'string' && printers.trim().length > 0) {
    return [printers.trim()];
  }
  return [];
}

/**
 * Get the operating system's default printer name via QZ Tray.
 */
export async function getDefaultPrinter(): Promise<string | null> {
  try {
    await connectQz();
    const defaultPrinter = await qz.printers.getDefault();
    return defaultPrinter ? defaultPrinter.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Suggest a likely TVS RP 3200 Lite or POS-80 thermal printer from available printer names.
 * Returns null if no match found.
 */
export function findSuggestedPrinter(printers: string[], defaultPrinter?: string | null): string | null {
  if (!printers || printers.length === 0) return null;

  const patterns = [
    /tvs.*3200/i,
    /rp\s*3200/i,
    /rp3200/i,
    /tvs/i,
    /pos-?80/i,
    /thermal/i,
    /receipt/i,
  ];

  for (const pattern of patterns) {
    const match = printers.find((p) => pattern.test(p));
    if (match) return match;
  }

  if (defaultPrinter && printers.includes(defaultPrinter)) {
    return defaultPrinter;
  }

  return null;
}

/**
 * Prepare full self-contained HTML for 80mm thermal receipt.
 * Configured with 2.5mm left breathing space inside 72mm total printable width.
 */
export function buildThermalReceiptHtml(receiptContentHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KBN Receipt</title>
  <style>
    @page {
      size: 72mm auto;
      margin: 0;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 72mm;
      max-width: 72mm;
      background: #fff;
      color: #000;
      font-family: 'JetBrains Mono', 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: geometricPrecision;
    }
    #printable-thermal-receipt {
      width: 72mm !important;
      max-width: 72mm !important;
      margin: 0 !important;
      padding: 2mm 1.5mm 8mm 2.5mm !important; /* ~2.5mm left breathing space, 1.5mm right margin, 8mm bottom pad for cutter */
      box-sizing: border-box !important;
      color: #000 !important;
      background: #fff !important;
      border: none !important;
      box-shadow: none !important;
    }
    #printable-thermal-receipt,
    #printable-thermal-receipt * {
      color: #000 !important;
    }
    #printable-thermal-receipt .border-stone-800,
    #printable-thermal-receipt .border-stone-500,
    #printable-thermal-receipt .border-stone-400,
    #printable-thermal-receipt .border-stone-300 {
      border-color: #000 !important;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    th, td {
      padding: 2px 0;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: bold; }
    .font-black { font-weight: 900; }
    .uppercase { text-transform: uppercase; }
    .border-t { border-top: 1px solid #000; }
    .border-t-2 { border-top: 2px solid #000; }
    .border-b { border-bottom: 1px solid #000; }
    .border-dashed { border-style: dashed; }
    .border-dotted { border-style: dotted; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    .flex { display: flex; }
    .justify-between { justify-content: space-between; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .align-top { vertical-align: top; }
    .space-y-0\\.5 > * + * { margin-top: 2px; }
    .my-1\\.5 { margin-top: 6px; margin-bottom: 6px; }
    .my-2 { margin-top: 8px; margin-bottom: 8px; }
    .pt-0\\.5 { padding-top: 2px; }
    .pt-1 { padding-top: 4px; }
    .pb-2 { padding-bottom: 8px; }
    .w-6 { width: 1.5rem; }
    .w-10 { width: 2.5rem; }
    .w-12 { width: 3rem; }
    .w-14 { width: 3.5rem; }
  </style>
</head>
<body>
  ${receiptContentHtml}
</body>
</html>`;
}

/**
 * Print thermal receipt directly to the confirmed printer via QZ Tray.
 * 
 * Guards against:
 * 1. Concurrent duplicate prints.
 * 2. Missing QZ Tray connection (returns error, does not silently print elsewhere).
 * 3. Unconfirmed printer (returns error, does not silently print to random default printer).
 */
export async function printReceiptViaQz(
  receiptElementOrHtml: HTMLElement | string,
  targetPrinterOverride?: string
): Promise<QzPrintResult> {
  // Prevent duplicate concurrent prints
  if (isPrintJobRunning) {
    return {
      success: false,
      errorCode: 'BUSY',
      error: 'A print job is already in progress. Please wait a moment.',
    };
  }

  isPrintJobRunning = true;

  try {
    // 1. Verify / establish connection
    try {
      await connectQz();
    } catch {
      return {
        success: false,
        errorCode: 'NOT_CONNECTED',
        error:
          'Could not connect to QZ Tray. Ensure the QZ Tray application is running on this computer.',
      };
    }

    if (!isQzActive()) {
      return {
        success: false,
        errorCode: 'NOT_CONNECTED',
        error: 'QZ Tray connection is inactive. Please ensure QZ Tray is started.',
      };
    }

    // 2. Identify confirmed printer (Never silently select an unverified printer)
    const printerToUse = targetPrinterOverride || getConfirmedPrinter();
    if (!printerToUse) {
      return {
        success: false,
        errorCode: 'NO_CONFIRMED_PRINTER',
        error:
          'No thermal printer has been confirmed. Please select and confirm your TVS RP 3200 printer in settings.',
      };
    }

    // 3. Extract and compile HTML
    let rawHtml = '';
    if (typeof receiptElementOrHtml === 'string') {
      rawHtml = receiptElementOrHtml;
    } else {
      rawHtml = receiptElementOrHtml.outerHTML || receiptElementOrHtml.innerHTML;
    }

    const fullHtml = buildThermalReceiptHtml(rawHtml);

    // 4. Configure print job for TVS RP 3200 Lite (80mm roll, 72mm printable width)
    const printConfig = qz.configs.create(printerToUse, {
      colorType: 'blackwhite',
      rasterize: true,
      size: { width: 72, height: null }, // 72mm width on 80mm roll
      units: 'mm',
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      scaleContent: true,
      density: 203, // 203 DPI standard for TVS RP 3200 Lite
    });

    const printData = [
      {
        type: 'pixel' as const,
        format: 'html' as const,
        flavor: 'plain' as const,
        data: fullHtml,
      },
    ];

    // 5. Send to printer
    await qz.print(printConfig, printData);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('QZ Tray direct print error:', err);
    return {
      success: false,
      errorCode: 'PRINT_FAILED',
      error: `Direct printing failed: ${message}`,
    };
  } finally {
    isPrintJobRunning = false;
  }
}

/**
 * Reusable React hook for QZ Tray thermal printing and printer configuration.
 */
export function useQzThermalPrinter(options?: {
  receiptContainerId?: string;
}) {
  const receiptId = options?.receiptContainerId || 'printable-thermal-receipt';
  const [confirmedPrinter, setConfirmedPrinterState] = useState<string | null>(getConfirmedPrinter());
  const [isConnected, setIsConnected] = useState<boolean>(isQzActive());
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState<boolean>(!getConfirmedPrinter());
  const [isLoadingPrinters, setIsLoadingPrinters] = useState<boolean>(false);

  // Proactively check connection on mount
  useEffect(() => {
    let isMounted = true;
    connectQz(0)
      .then(() => {
        if (isMounted) setIsConnected(true);
      })
      .catch(() => {
        if (isMounted) setIsConnected(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch available printers from QZ Tray
  const refreshPrinters = useCallback(async (): Promise<string[]> => {
    setIsLoadingPrinters(true);
    setError(null);
    try {
      await connectQz();
      setIsConnected(true);
      const list = await listAvailablePrinters();
      setAvailablePrinters(list);
      return list;
    } catch (err: unknown) {
      setIsConnected(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Cannot connect to QZ Tray: ${msg}. Make sure QZ Tray is running.`);
      return [];
    } finally {
      setIsLoadingPrinters(false);
    }
  }, []);

  // Save confirmed printer
  const confirmPrinter = useCallback((printerName: string) => {
    setConfirmedPrinter(printerName);
    setConfirmedPrinterState(printerName);
    setShowConfig(false);
    setError(null);
  }, []);

  // Clear confirmed printer
  const resetPrinter = useCallback(() => {
    clearConfirmedPrinter();
    setConfirmedPrinterState(null);
    setShowConfig(true);
  }, []);

  // Direct print via QZ Tray (No automatic fallback to browser print)
  const printDirect = useCallback(async (): Promise<boolean> => {
    setError(null);
    setPrintSuccess(false);

    const elem = document.getElementById(receiptId);
    if (!elem) {
      setError('Receipt preview element not found.');
      return false;
    }

    const currentPrinter = getConfirmedPrinter();
    if (!currentPrinter) {
      setError('No printer has been confirmed. Please select your TVS RP 3200 printer below.');
      setShowConfig(true);
      void refreshPrinters();
      return false;
    }

    setIsPrinting(true);
    try {
      const result = await printReceiptViaQz(elem, currentPrinter);
      if (result.success) {
        setPrintSuccess(true);
        setIsConnected(true);
        return true;
      } else {
        if (result.errorCode === 'NOT_CONNECTED') {
          setIsConnected(false);
        }
        setError(result.error || 'Direct printing failed.');
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Printing error: ${msg}`);
      return false;
    } finally {
      setIsPrinting(false);
    }
  }, [receiptId, refreshPrinters]);

  // Separate, explicit manual browser print
  const printBrowser = useCallback(() => {
    try {
      window.print();
    } catch (err: unknown) {
      console.warn('Manual browser print failed:', err);
    }
  }, []);

  return {
    confirmedPrinter,
    isConnected,
    isPrinting,
    printSuccess,
    error,
    showConfig,
    availablePrinters,
    isLoadingPrinters,
    setShowConfig,
    setError,
    refreshPrinters,
    confirmPrinter,
    resetPrinter,
    printDirect,
    printBrowser,
  };
}
