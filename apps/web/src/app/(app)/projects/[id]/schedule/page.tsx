"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@constructionos/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { getAccessToken } from "@/lib/session";

interface Project {
  id: string;
  name: string;
  code: string;
}

interface Schedule {
  id: string;
  dataDate: string;
  scheduleVersion: number;
}

interface Activity {
  id: string;
  wbsPath: string | null;
  name: string;
  durationDays: number;
  startDate: string | null;
  endDate: string | null;
  percentComplete: string;
  isMilestone: boolean;
  isCritical: boolean;
  totalFloatDays: number | null;
}

type DependencyType = "FS" | "SS" | "FF" | "SF";

interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export default function ProjectSchedulePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

  async function reload() {
    const [projectData, scheduleData] = await Promise.all([
      apiClient.get<Project>(`/projects/${params.id}`),
      apiClient.get<{ schedule: Schedule; activities: Activity[]; dependencies: Dependency[] }>(
        `/projects/${params.id}/schedule`,
      ),
    ]);
    setProject(projectData);
    setSchedule(scheduleData.schedule);
    setActivities(scheduleData.activities);
    setDependencies(scheduleData.dependencies);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load schedule"))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function recalculate() {
    if (!schedule) return;
    setRecalculating(true);
    setError(null);
    setRecalcMessage(null);
    try {
      const result = await apiClient.post<{ jobId?: string; schedule?: Schedule; activities?: Activity[] }>(
        `/schedules/${schedule.id}/recalculate`,
        {},
      );
      if (result.jobId) {
        setRecalcMessage("Recalculation queued — check back shortly.");
      } else {
        setSchedule(result.schedule!);
        setActivities(result.activities!);
        setRecalcMessage("Recalculated.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to recalculate");
    } finally {
      setRecalculating(false);
    }
  }

  async function deleteActivity(id: string) {
    try {
      await apiClient.delete(`/activities/${id}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete activity");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (error && !project) {
    return <ErrorState variant="page" message={error} onRetry={() => location.reload()} />;
  }

  if (!project || !schedule) return null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <button
        type="button"
        onClick={() => router.push(`/projects/${params.id}`)}
        className="flex w-fit items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" />
        {project.name}
      </button>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-neutral-900">Schedule</h1>
          <span className="font-mono text-sm text-neutral-500">
            {project.code} &middot; data date {schedule.dataDate}
          </span>
        </div>
        <Button variant="secondary" size="sm" loading={recalculating} onClick={recalculate}>
          Recalculate
        </Button>
      </div>

      {error && <ErrorState variant="inline" message={error} />}
      {recalcMessage && !error && <p className="text-sm text-neutral-500">{recalcMessage}</p>}

      <Card padding="default" className="p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <CardTitle>Activities</CardTitle>
          <NewActivityDialog open={newOpen} onOpenChange={setNewOpen} scheduleId={schedule.id} onCreated={reload} />
        </div>
        {activities.length === 0 ? (
          <EmptyState
            title="No activities yet"
            description="Add activities, then Recalculate to compute the critical path."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WBS</TableHead>
                <TableHead>Name</TableHead>
                <TableHead align="right">Duration</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead align="right">Float</TableHead>
                <TableHead align="right">% complete</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((activity) => (
                <ActivityRow
                  key={activity.id}
                  activity={activity}
                  activities={activities}
                  dependencies={dependencies}
                  onSaved={reload}
                  onDelete={() => deleteActivity(activity.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  );
}

function ActivityRow({
  activity,
  activities,
  dependencies,
  onSaved,
  onDelete,
}: {
  activity: Activity;
  activities: Activity[];
  dependencies: Dependency[];
  onSaved: () => Promise<void>;
  onDelete: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [depsOpen, setDepsOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-mono text-neutral-500">{activity.wbsPath ?? "—"}</TableCell>
      <TableCell>
        <span className="text-neutral-900">{activity.name}</span>
        {activity.isMilestone && <StatusChip label="Milestone" tone="ai" className="ml-2" />}
        {activity.isCritical && <StatusChip label="Critical" tone="danger" className="ml-2" />}
      </TableCell>
      <TableCell align="right" numeric>
        {activity.durationDays}d
      </TableCell>
      <TableCell>{activity.startDate ?? "—"}</TableCell>
      <TableCell>{activity.endDate ?? "—"}</TableCell>
      <TableCell align="right" numeric>
        {activity.totalFloatDays ?? "—"}
      </TableCell>
      <TableCell align="right" numeric>
        {Number(activity.percentComplete)}%
      </TableCell>
      <TableCell align="right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDepsOpen(true)}>
            Dependencies
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </TableCell>
      <EditActivityDialog open={editOpen} onOpenChange={setEditOpen} activity={activity} onSaved={onSaved} />
      <DependenciesDialog
        open={depsOpen}
        onOpenChange={setDepsOpen}
        activity={activity}
        activities={activities}
        dependencies={dependencies}
        onSaved={onSaved}
      />
    </TableRow>
  );
}

function NewActivityDialog({
  open,
  onOpenChange,
  scheduleId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [wbsPath, setWbsPath] = useState("");
  const [durationDays, setDurationDays] = useState("1");
  const [isMilestone, setIsMilestone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setWbsPath("");
    setDurationDays("1");
    setIsMilestone(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/schedules/${scheduleId}/activities`, {
        name,
        durationDays: Number(durationDays) || 0,
        isMilestone,
        ...(wbsPath ? { wbsPath } : {}),
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add activity");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus />
          Add activity
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New activity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="WBS path">
            {({ inputId }) => <Input id={inputId} value={wbsPath} onChange={(e) => setWbsPath(e.target.value)} />}
          </Field>
          <Field label="Duration (days)" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                type="number"
                min={0}
                step="1"
                required
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-900">
            <Checkbox checked={isMilestone} onCheckedChange={(checked) => setIsMilestone(checked === true)} />
            Milestone
          </label>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditActivityDialog({
  open,
  onOpenChange,
  activity,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(activity.name);
  const [wbsPath, setWbsPath] = useState(activity.wbsPath ?? "");
  const [durationDays, setDurationDays] = useState(String(activity.durationDays));
  const [percentComplete, setPercentComplete] = useState(String(Number(activity.percentComplete)));
  const [isMilestone, setIsMilestone] = useState(activity.isMilestone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(activity.name);
    setWbsPath(activity.wbsPath ?? "");
    setDurationDays(String(activity.durationDays));
    setPercentComplete(String(Number(activity.percentComplete)));
    setIsMilestone(activity.isMilestone);
  }, [activity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/activities/${activity.id}`, {
        name,
        durationDays: Number(durationDays) || 0,
        percentComplete: Number(percentComplete) || 0,
        isMilestone,
        wbsPath: wbsPath || null,
      });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update activity");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="WBS path">
            {({ inputId }) => <Input id={inputId} value={wbsPath} onChange={(e) => setWbsPath(e.target.value)} />}
          </Field>
          <Field label="Duration (days)" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                type="number"
                min={0}
                step="1"
                required
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
              />
            )}
          </Field>
          <Field label="% complete">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="number"
                min={0}
                max={100}
                step="1"
                value={percentComplete}
                onChange={(e) => setPercentComplete(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-900">
            <Checkbox checked={isMilestone} onCheckedChange={(checked) => setIsMilestone(checked === true)} />
            Milestone
          </label>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DependencyDraft {
  key: string;
  predecessorId: string;
  type: DependencyType;
  lagDays: string;
}

function DependenciesDialog({
  open,
  onOpenChange,
  activity,
  activities,
  dependencies,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  activities: Activity[];
  dependencies: Dependency[];
  onSaved: () => Promise<void>;
}) {
  const otherActivities = activities.filter((a) => a.id !== activity.id);
  const [rows, setRows] = useState<DependencyDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = dependencies
      .filter((d) => d.successorId === activity.id)
      .map((d) => ({ key: d.id, predecessorId: d.predecessorId, type: d.type, lagDays: String(d.lagDays) }));
    setRows(existing);
  }, [activity, dependencies, open]);

  function addRow() {
    setRows((r) => [
      ...r,
      { key: `new-${Date.now()}-${r.length}`, predecessorId: otherActivities[0]?.id ?? "", type: "FS", lagDays: "0" },
    ]);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }

  function updateRow(key: string, patch: Partial<DependencyDraft>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.put(`/activities/${activity.id}/dependencies`, {
        dependencies: rows
          .filter((r) => r.predecessorId)
          .map((r) => ({ predecessorId: r.predecessorId, type: r.type, lagDays: Number(r.lagDays) || 0 })),
      });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update dependencies");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>Dependencies — {activity.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-500">No predecessors yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <Select
                    value={row.predecessorId}
                    onValueChange={(value) => updateRow(row.key, { predecessorId: value })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Predecessor" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherActivities.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.wbsPath ? `${a.wbsPath} — ${a.name}` : a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={row.type}
                    onValueChange={(value) => updateRow(row.key, { type: value as DependencyType })}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["FS", "SS", "FF", "SF"] as DependencyType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="1"
                    className="w-20"
                    value={row.lagDays}
                    onChange={(e) => updateRow(row.key, { lagDays: e.target.value })}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(row.key)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            disabled={otherActivities.length === 0}
            onClick={addRow}
          >
            <Plus />
            Add predecessor
          </Button>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Save dependencies
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
