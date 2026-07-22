import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { RbacModule } from "../rbac";
import { TasksModule } from "../tasks";
import { SyncController } from "./api/sync.controller";
import { SyncConflictsService } from "./application/sync-conflicts.service";
import { SyncDeltaService } from "./application/sync-delta.service";
import { SyncMutationsService } from "./application/sync-mutations.service";
import { SyncWorkingSetService } from "./application/sync-working-set.service";

const env = loadEnv();

@Module({
  imports: [RbacModule, TasksModule],
  controllers: [SyncController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    SyncMutationsService,
    SyncDeltaService,
    SyncWorkingSetService,
    SyncConflictsService,
  ],
})
export class SyncModule {}
