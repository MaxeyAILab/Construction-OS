import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../../src/modules/ai/domain/ai-provider";

// Test double for the AI_PROVIDER interface — mirrors FakeStorageService's
// role in the Files module tests (test/setup/files.ts): a real
// implementation of the interface with no network calls, so
// AiGatewayService's own logic (budget enforcement, metering, outcome
// recording) is exercised without needing a real ANTHROPIC_API_KEY.
export class FakeAiProvider implements AiProvider {
  lastRequest: AiCompletionRequest | null = null;
  private response: AiCompletionResult = { content: "fake response", inputTokens: 100, outputTokens: 50 };
  private shouldThrow = false;

  setResponse(response: AiCompletionResult): void {
    this.response = response;
  }

  setShouldThrow(value: boolean): void {
    this.shouldThrow = value;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    this.lastRequest = request;
    if (this.shouldThrow) throw new Error("fake provider failure");
    return this.response;
  }
}

export function buildTestAiServices(db: Database): {
  aiGatewayService: AiGatewayService;
  provider: FakeAiProvider;
} {
  const provider = new FakeAiProvider();
  return { aiGatewayService: new AiGatewayService(db, provider), provider };
}
