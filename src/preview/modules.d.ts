// SPDX-License-Identifier: AGPL-3.0-or-later
// Type declarations for the two preview libraries that ship without them.

declare module 'utif' {
  interface IFD {
    width: number;
    height: number;
    t256?: number[];
    [key: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): IFD[];
    decodeImage(buf: ArrayBuffer, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}

declare module 'sql.js' {
  interface QueryResult {
    columns: string[];
    values: unknown[][];
  }
  interface Database {
    exec(sql: string): QueryResult[];
    close(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
