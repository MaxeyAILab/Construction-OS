// clamdjs ships no types. Minimal ambient declaration covering only the
// surface this codebase actually calls (infrastructure/clamav-scanner.ts).
declare module "clamdjs" {
  export interface ClamdScanner {
    scanBuffer(buffer: Buffer, timeout?: number, chunkSize?: number): Promise<string>;
  }
  export function createScanner(host: string, port: number): ClamdScanner;
  export function isCleanReply(reply: string): boolean;
}
