declare module 'qz-tray' {
  export interface QzPrintConfigOptions {
    bounds?: unknown;
    colorType?: 'color' | 'grayscale' | 'blackwhite';
    copies?: number;
    density?: number | string;
    duplex?: boolean | string;
    fallback?: boolean;
    header?: unknown;
    footer?: unknown;
    interpolation?: string;
    jobName?: string;
    legacy?: boolean;
    margins?: number | { top?: number; right?: number; bottom?: number; left?: number };
    orientation?: 'portrait' | 'landscape' | 'reverse-landscape';
    paperThickness?: unknown;
    printerTray?: string;
    rasterize?: boolean;
    rotation?: number;
    scaleContent?: boolean;
    size?: { width?: number; height?: number | null };
    spool?: unknown;
    units?: 'in' | 'cm' | 'mm' | 'px';
    altPrinting?: boolean;
    encoding?: string;
    endOfDoc?: string;
    perSpool?: number;
  }

  export interface QzPrintData {
    type: 'pixel' | 'raw' | 'postscript' | 'pdf' | 'image' | 'html';
    format: 'html' | 'image' | 'pdf' | 'command' | 'plain' | 'base64' | 'hex';
    flavor?: 'plain' | 'base64' | 'file';
    data: string | unknown;
    options?: unknown;
  }

  export interface QzWebsocketOptions {
    host?: string;
    hostHeaders?: Record<string, string>;
    usingSecure?: boolean;
    protocol?: string;
    port?: {
      secure?: number[];
      insecure?: number[];
    };
    keepAlive?: number;
    retries?: number;
    delay?: number;
  }

  export interface QzWebsocket {
    connect(options?: QzWebsocketOptions): Promise<void>;
    disconnect(): Promise<void>;
    isActive(): boolean;
    getConnectionInfo(): unknown;
  }

  export interface QzPrinters {
    find(query?: string, signature?: string, signingTimestamp?: number): Promise<string[] | string>;
    getDefault(signature?: string, signingTimestamp?: number): Promise<string>;
    details(): Promise<unknown>;
    startListening(printers: string | string[] | null, options?: unknown): Promise<unknown>;
    stopListening(): Promise<unknown>;
  }

  export interface QzConfigs {
    create(printer: string, options?: QzPrintConfigOptions): unknown;
  }

  export interface QzSecurity {
    setCertificatePromise(promiseFn: (resolve: (cert: string) => void, reject: (err: unknown) => void) => void): void;
    setSignatureAlgorithm(algorithm: string): void;
    setSignaturePromise(
      promiseFn: (toSign: string) => ((resolve: (sig: string) => void, reject: (err: unknown) => void) => void) | Promise<string>
    ): void;
  }

  export interface QzApi {
    showDebug(show: boolean): void;
    getWebsocketType(): unknown;
    setWebSocketType(ws: unknown): void;
  }

  export interface QzTray {
    websocket: QzWebsocket;
    printers: QzPrinters;
    configs: QzConfigs;
    print(config: unknown, data: QzPrintData[]): Promise<void>;
    security: QzSecurity;
    api: QzApi;
    version: string;
  }

  const qz: QzTray;
  export default qz;
}
