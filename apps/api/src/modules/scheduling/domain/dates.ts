// Pure date-offset arithmetic for converting CPM day-offsets (relative to a
// schedule's data_date) into real ISO calendar dates. UTC-anchored (not
// local time) so a day boundary can't shift depending on server timezone.

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A CPM day-offset range [earlyStart, earlyFinish) is exclusive of its end
// (duration=5 spans offsets 0..5, i.e. 5 calendar days starting at
// data_date+0). end_date is reported as the last *inclusive* day worked —
// data_date + (earlyFinish - 1) — except for zero-duration milestones,
// whose start and end are the same instantaneous point.
export function activityDatesFromOffsets(
  dataDate: string,
  earlyStart: number,
  earlyFinish: number,
): { startDate: string; endDate: string } {
  const startDate = addDaysToIsoDate(dataDate, earlyStart);
  const endDate =
    earlyFinish === earlyStart ? startDate : addDaysToIsoDate(dataDate, earlyFinish - 1);
  return { startDate, endDate };
}
