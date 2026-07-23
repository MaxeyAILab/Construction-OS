import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { DailyReportsController } from "./api/daily-reports.controller";
import { TimeEntriesController } from "./api/time-entries.controller";
import { DailyReportsService } from "./application/daily-reports.service";
import { TimeEntriesService } from "./application/time-entries.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule],
  controllers: [DailyReportsController, TimeEntriesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    DailyReportsService,
    TimeEntriesService,
  ],
  // M6 Mobile Sync (architecture.md §14.2) reuses these for its
  // 'daily_reports'/'time_entries' mutation handlers — same precedent as
  // TasksModule exporting TasksService.
  exports: [DailyReportsService, TimeEntriesService],
})
export class DailyReportsModule {}
