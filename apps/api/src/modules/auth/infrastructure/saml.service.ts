import { Injectable } from "@nestjs/common";
import { SAML } from "@node-saml/node-saml";
import { loadEnv } from "../../../config/env";
import { InvalidSamlAssertionError } from "../domain/errors";

const env = loadEnv();

export interface SsoConnectionConfig {
  id: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  // jsonb column — typed loosely at the drizzle boundary; narrowed just
  // below via isAttributeMapping.
  attributeMapping?: unknown;
}

function isAttributeMapping(value: unknown): value is { email?: string; fullName?: string } {
  return typeof value === "object" && value !== null;
}

export interface SamlAssertionResult {
  email: string;
  fullName: string;
}

function spEntityId(connectionId: string): string {
  return `${env.API_BASE_URL}/v1/auth/sso/${connectionId}/metadata`;
}

function acsUrl(connectionId: string): string {
  return `${env.API_BASE_URL}/v1/auth/sso/${connectionId}/acs`;
}

// api.md §2.1: thin wrapper over @node-saml/node-saml — SAML signature
// validation is exactly the kind of crypto-correctness-critical code that
// should never be hand-rolled (CLAUDE.md "don't introduce security
// vulnerabilities"). One SAML client is built per request from the
// connection's own stored config rather than kept as long-lived state,
// since each tenant's connection has different IdP settings.
@Injectable()
export class SamlService {
  private buildClient(connection: SsoConnectionConfig): SAML {
    return new SAML({
      idpCert: connection.idpCertificate,
      issuer: spEntityId(connection.id),
      callbackUrl: acsUrl(connection.id),
      entryPoint: connection.idpSsoUrl,
      // Signed assertions are the whole security model here — an
      // unsigned-assertion IdP config is not a supported connection.
      wantAssertionsSigned: true,
      identifierFormat: null,
    });
  }

  async getLoginUrl(connection: SsoConnectionConfig, relayState = ""): Promise<string> {
    return this.buildClient(connection).getAuthorizeUrlAsync(relayState, undefined, {});
  }

  spMetadata(connection: SsoConnectionConfig): string {
    return this.buildClient(connection).generateServiceProviderMetadata(null);
  }

  async validateAssertion(
    connection: SsoConnectionConfig,
    body: Record<string, string>,
  ): Promise<SamlAssertionResult> {
    const saml = this.buildClient(connection);
    let profile;
    try {
      ({ profile } = await saml.validatePostResponseAsync(body));
    } catch {
      throw new InvalidSamlAssertionError();
    }
    if (!profile) throw new InvalidSamlAssertionError();

    const mapping = isAttributeMapping(connection.attributeMapping) ? connection.attributeMapping : {};
    const mappedEmail = mapping.email ? profile[mapping.email] : undefined;
    const email =
      (typeof mappedEmail === "string" && mappedEmail) ||
      profile.email ||
      profile.mail ||
      (profile.nameIDFormat?.includes("emailAddress") ? profile.nameID : undefined);
    if (!email || typeof email !== "string") throw new InvalidSamlAssertionError();

    const mappedName = mapping.fullName ? profile[mapping.fullName] : undefined;
    const fullName =
      (typeof mappedName === "string" && mappedName) ||
      (typeof profile.displayName === "string" && profile.displayName) ||
      (typeof profile.cn === "string" && profile.cn) ||
      email;

    return { email, fullName };
  }
}
