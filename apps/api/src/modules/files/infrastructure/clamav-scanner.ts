import { Inject, Injectable } from "@nestjs/common";
import { isCleanReply, type ClamdScanner } from "clamdjs";
import type { VirusScanner, VirusScanResult } from "../domain/virus-scanner";
import { CLAMD_SCANNER } from "./clamd-client";

const SCAN_TIMEOUT_MS = 60_000;

@Injectable()
export class ClamAvScanner implements VirusScanner {
  constructor(@Inject(CLAMD_SCANNER) private readonly scanner: ClamdScanner) {}

  async scan(buffer: Buffer): Promise<VirusScanResult> {
    const reply = await this.scanner.scanBuffer(buffer, SCAN_TIMEOUT_MS);
    if (isCleanReply(reply)) return { clean: true };
    const match = /: (.+) FOUND/.exec(reply);
    return { clean: false, signature: match?.[1] ?? "unknown" };
  }
}
