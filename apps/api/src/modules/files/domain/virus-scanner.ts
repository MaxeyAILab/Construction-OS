export const VIRUS_SCANNER = Symbol("VIRUS_SCANNER");

export interface VirusScanResult {
  clean: boolean;
  /** Malware signature name, present only when clean is false. */
  signature?: string;
}

/**
 * architecture.md §13: "virus scan (ClamAV)" post-upload step. Abstracted
 * behind an interface (rather than calling clamdjs directly from the
 * worker) so tests can substitute a fake scanner without a running clamd
 * daemon — see infrastructure/clamav-scanner.ts for the real implementation.
 */
export interface VirusScanner {
  scan(buffer: Buffer): Promise<VirusScanResult>;
}
