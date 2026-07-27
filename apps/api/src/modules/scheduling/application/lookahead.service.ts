import { Injectable } from "@nestjs/common";
import type { LookaheadQuery } from "@constructionos/schemas";
import { SchedulesService } from "./schedules.service";

export interface LookaheadActivity {
  id: string;
  name: string;
  wbsPath: string | null;
  startDate: string | null;
  endDate: string | null;
  percentComplete: string;
  isCritical: boolean;
  crew: unknown;
}

// api.md §6: "GET /projects/{id}/lookahead?weeks=3 | read | Lookahead view
// (FR-SCH-3)" — a short-interval pull-plan grouping the master schedule's
// activities into weekly buckets from the schedule's data_date, rather
// than a separate persisted entity. Reuses SchedulesService.
// getActiveSchedule() for its dual-path auth (internal schedule.read or a
// client-portal project "view" share — same precedent as that method's own
// M13 Client Portal doc comment) instead of duplicating it here.
@Injectable()
export class LookaheadService {
  constructor(private readonly schedules: SchedulesService) {}

  async getLookahead(tenantId: string, actorId: string, projectId: string, query: LookaheadQuery) {
    const { schedule, activities } = await this.schedules.getActiveSchedule(tenantId, actorId, projectId);

    const dataDate = new Date(`${schedule.dataDate}T00:00:00Z`);
    const weeks: { weekStart: string; weekEnd: string; activities: LookaheadActivity[] }[] = [];

    for (let w = 0; w < query.weeks; w++) {
      const weekStart = new Date(dataDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

      const weekActivities = activities
        .filter((a) => {
          if (!a.startDate || !a.endDate) return false;
          const start = new Date(`${a.startDate}T00:00:00Z`);
          const end = new Date(`${a.endDate}T00:00:00Z`);
          return start < weekEnd && end >= weekStart;
        })
        .map((a) => ({
          id: a.id,
          name: a.name,
          wbsPath: a.wbsPath,
          startDate: a.startDate,
          endDate: a.endDate,
          percentComplete: a.percentComplete,
          isCritical: a.isCritical,
          crew: a.crew,
        }));

      weeks.push({
        weekStart: weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        activities: weekActivities,
      });
    }

    return { scheduleId: schedule.id, dataDate: schedule.dataDate, weeks };
  }
}
