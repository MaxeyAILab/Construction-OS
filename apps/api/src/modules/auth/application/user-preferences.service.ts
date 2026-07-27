import { Inject, Injectable } from "@nestjs/common";
import type { UpdateUserPreferencesInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { users } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { InvalidCredentialsError } from "../domain/errors";

// api.md §2: GET/PATCH /auth/me/preferences — see
// @constructionos/schemas' updateUserPreferencesSchema doc comment for why
// this is locale-only (the notification-prefs matrix already has its own
// endpoint at GET/PUT /notification-preferences).
@Injectable()
export class UserPreferencesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async get(userId: string): Promise<{ locale: string }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new InvalidCredentialsError();
    return { locale: user.locale };
  }

  async update(
    tenantId: string,
    userId: string,
    input: UpdateUserPreferencesInput,
  ): Promise<{ locale: string }> {
    if (input.locale === undefined) return this.get(userId);

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ locale: input.locale })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw new InvalidCredentialsError();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "user.preferences_updated.v1",
        dedupeKey: `user.preferences_updated.v1:${userId}:${Date.now()}`,
        actorId: userId,
        payload: { companyId: tenantId, userId, locale: updated.locale },
      });

      return { locale: updated.locale };
    });
  }
}
