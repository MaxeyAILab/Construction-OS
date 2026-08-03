"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  CurrencyInput,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ErrorState,
  Field,
  Input,
  MetricCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusChip,
  Textarea,
  type StatusTone,
} from "@constructionos/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { getAccessToken } from "@/lib/session";

type ProjectStatus = "planning" | "active" | "on_hold" | "closed" | "warranty";

interface Project {
  id: string;
  name: string;
  code: string;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  contractValueAmount: string | null;
  currency: string;
  updatedSeq: number;
}

interface ProjectSummary {
  team: { memberCount: number };
  costCodes: { count: number };
  milestones: { total: number; completed: number };
  scheduleVariance: { varianceDays: number; baselineFinishDate: string; currentFinishDate: string } | null;
  margin: { amount: string | null; pct: number | null };
  openItems: { tasks: number; rfis: number };
}

interface Milestone {
  id: string;
  name: string;
  dueDate: string | null;
  completedAt: string | null;
  sortOrder: number;
}

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: string | null;
}

type RfiStatus = "draft" | "open" | "answered" | "closed" | "void";

interface Rfi {
  id: string;
  number: number;
  subject: string;
  question: string;
  answer: string | null;
  status: RfiStatus;
  dueDate: string | null;
}

type IncidentKind = "incident" | "near_miss" | "observation";
type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "open" | "closed";

interface Incident {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity | null;
  status: IncidentStatus;
  occurredAt: string;
  location: string | null;
  description: string | null;
  oshaRecordable: boolean;
  correctiveActionTaskId: string | null;
}

const STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  planning: "neutral",
  active: "success",
  on_hold: "warning",
  closed: "neutral",
  warranty: "ai",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  closed: "Closed",
  warranty: "Warranty",
};

// Mirrors apps/api's status-transitions.ts — the server is the source of
// truth (an illegal choice here still 422s), this just keeps the picker
// from offering choices that would obviously fail.
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ["planning", "active"],
  active: ["active", "on_hold", "closed"],
  on_hold: ["on_hold", "active", "closed"],
  closed: ["closed", "warranty"],
  warranty: ["warranty"],
};

const PRIORITY_TONE: Record<TaskPriority, StatusTone> = {
  low: "neutral",
  medium: "neutral",
  high: "warning",
  urgent: "danger",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const RFI_STATUS_TONE: Record<RfiStatus, StatusTone> = {
  draft: "neutral",
  open: "warning",
  answered: "success",
  closed: "neutral",
  void: "danger",
};

const RFI_STATUS_LABEL: Record<RfiStatus, string> = {
  draft: "Draft",
  open: "Open",
  answered: "Answered",
  closed: "Closed",
  void: "Void",
};

// Mirrors apps/api's RfisService ALLOWED_TRANSITIONS — server remains the
// source of truth (an illegal choice here still 422s); includes the
// current status itself so the edit dialog's picker always has a value.
const RFI_ALLOWED_TRANSITIONS: Record<RfiStatus, RfiStatus[]> = {
  draft: ["draft", "open", "void"],
  open: ["open", "answered", "closed", "void"],
  answered: ["answered", "closed", "void"],
  closed: ["closed"],
  void: ["void"],
};

const INCIDENT_KIND_LABEL: Record<IncidentKind, string> = {
  incident: "Incident",
  near_miss: "Near miss",
  observation: "Observation",
};

// database.md doesn't enumerate severity's values — this ordering (low ->
// critical) mirrors packages/schemas' own documented assumption.
const INCIDENT_SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  low: "neutral",
  medium: "warning",
  high: "warning",
  critical: "danger",
};

const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const INCIDENT_STATUS_TONE: Record<IncidentStatus, StatusTone> = {
  open: "warning",
  closed: "success",
};

const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  closed: "Closed",
};

function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [rfiOpen, setRfiOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  async function reload() {
    const [projectData, summaryData, milestonesData, tasksData, rfisData, incidentsData] = await Promise.all([
      apiClient.get<Project>(`/projects/${params.id}`),
      apiClient.get<ProjectSummary>(`/projects/${params.id}/summary`),
      apiClient.get<Milestone[]>(`/projects/${params.id}/milestones`),
      apiClient.get<Task[]>(`/tasks?projectId=${params.id}&limit=50`),
      apiClient.get<Rfi[]>(`/projects/${params.id}/rfis`),
      apiClient.get<Incident[]>(`/projects/${params.id}/incidents?limit=50`),
    ]);
    setProject(projectData);
    setSummary(summaryData);
    setMilestones(milestonesData);
    setTasks(tasksData);
    setRfis(rfisData);
    setIncidents(incidentsData);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load project"))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function toggleMilestone(milestone: Milestone) {
    try {
      await apiClient.patch(`/projects/${params.id}/milestones/${milestone.id}`, {
        completed: milestone.completedAt === null,
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update milestone");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await apiClient.patch(`/tasks/${task.id}`, {
        status: task.status === "done" ? "todo" : "done",
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update task");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }

  if (error && !project) {
    return <ErrorState variant="page" message={error} onRetry={() => location.reload()} />;
  }

  if (!project || !summary) return null;

  const varianceDays = summary.scheduleVariance?.varianceDays ?? null;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <button
        type="button"
        onClick={() => router.push("/projects")}
        className="flex w-fit items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" />
        Projects
      </button>

      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-neutral-900">{project.name}</h1>
            <StatusChip label={STATUS_LABEL[project.status]} tone={STATUS_TONE[project.status]} />
          </div>
          <span className="font-mono text-sm text-neutral-500">{project.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => router.push(`/projects/${params.id}/budget`)}>
            Budget
          </Button>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/projects/${params.id}/change-orders`)}>
            Change orders
          </Button>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/projects/${params.id}/schedule`)}>
            Schedule
          </Button>
          <EditProjectDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            project={project}
            onSaved={reload}
          />
        </div>
      </div>

      {error && <ErrorState variant="inline" message={error} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Contract value" value={formatMoney(project.contractValueAmount, project.currency)} />
        <MetricCard
          label="Margin"
          value={formatMoney(summary.margin.amount, project.currency)}
          {...(summary.margin.pct !== null
            ? {
                delta: {
                  value: `${summary.margin.pct.toFixed(1)}%`,
                  direction: summary.margin.pct >= 0 ? ("up" as const) : ("down" as const),
                  tone: summary.margin.pct >= 0 ? ("success" as const) : ("danger" as const),
                },
              }
            : {})}
        />
        <MetricCard
          label="Schedule variance"
          value={varianceDays === null ? "No baseline yet" : `${Math.abs(varianceDays)}d ${varianceDays > 0 ? "behind" : "ahead"}`}
          {...(varianceDays !== null && varianceDays !== 0
            ? {
                delta: {
                  value: varianceDays > 0 ? "behind baseline" : "ahead of baseline",
                  direction: varianceDays > 0 ? ("down" as const) : ("up" as const),
                  tone: varianceDays > 0 ? ("danger" as const) : ("success" as const),
                },
              }
            : {})}
        />
        <MetricCard label="Open items" value={`${summary.openItems.tasks + summary.openItems.rfis}`} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="flex flex-col gap-1">
          <span className="text-sm text-neutral-500">Team</span>
          <span className="text-lg font-semibold text-neutral-900">{summary.team.memberCount}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-sm text-neutral-500">Cost codes</span>
          <span className="text-lg font-semibold text-neutral-900">{summary.costCodes.count}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-sm text-neutral-500">Milestones</span>
          <span className="text-lg font-semibold text-neutral-900">
            {summary.milestones.completed}/{summary.milestones.total}
          </span>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Milestones</CardTitle>
          <NewMilestoneDialog
            open={milestoneOpen}
            onOpenChange={setMilestoneOpen}
            projectId={params.id}
            onCreated={reload}
          />
        </CardHeader>
        {milestones.length === 0 ? (
          <p className="text-sm text-neutral-500">No milestones yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={milestone.completedAt !== null}
                  onCheckedChange={() => toggleMilestone(milestone)}
                  aria-label={milestone.name}
                />
                <span className={milestone.completedAt ? "text-neutral-500 line-through" : "text-neutral-900"}>
                  {milestone.name}
                </span>
                {milestone.dueDate && <span className="text-neutral-500">— due {milestone.dueDate}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Tasks</CardTitle>
          <NewTaskDialog open={taskOpen} onOpenChange={setTaskOpen} projectId={params.id} onCreated={reload} />
        </CardHeader>
        {tasks.length === 0 ? (
          <p className="text-sm text-neutral-500">No tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={task.status === "done"}
                  onCheckedChange={() => toggleTask(task)}
                  aria-label={task.title}
                />
                <span className={task.status === "done" ? "flex-1 text-neutral-500 line-through" : "flex-1 text-neutral-900"}>
                  {task.title}
                </span>
                {task.priority && <StatusChip label={PRIORITY_LABEL[task.priority]} tone={PRIORITY_TONE[task.priority]} />}
                {task.dueDate && <span className="text-neutral-500">due {task.dueDate}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>RFIs</CardTitle>
          <NewRfiDialog open={rfiOpen} onOpenChange={setRfiOpen} projectId={params.id} onCreated={reload} />
        </CardHeader>
        {rfis.length === 0 ? (
          <p className="text-sm text-neutral-500">No RFIs yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rfis.map((rfi) => (
              <RfiRow key={rfi.id} rfi={rfi} onSaved={reload} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Safety incidents</CardTitle>
          <NewIncidentDialog
            open={incidentOpen}
            onOpenChange={setIncidentOpen}
            projectId={params.id}
            onCreated={reload}
          />
        </CardHeader>
        {incidents.length === 0 ? (
          <p className="text-sm text-neutral-500">No incidents reported.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incidents.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} onSaved={reload} />
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function RfiRow({ rfi, onSaved }: { rfi: Rfi; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="font-mono text-neutral-500">#{rfi.number}</span>
      <span className="flex-1 text-neutral-900">{rfi.subject}</span>
      <StatusChip label={RFI_STATUS_LABEL[rfi.status]} tone={RFI_STATUS_TONE[rfi.status]} />
      {rfi.dueDate && <span className="text-neutral-500">due {rfi.dueDate}</span>}
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Open
      </Button>
      <EditRfiDialog open={open} onOpenChange={setOpen} rfi={rfi} onSaved={onSaved} />
    </li>
  );
}

function IncidentRow({ incident, onSaved }: { incident: Incident; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="flex items-center gap-2 text-sm">
      <StatusChip label={INCIDENT_KIND_LABEL[incident.kind]} tone="neutral" />
      <span className="flex-1 text-neutral-900">{incident.description || "(no description)"}</span>
      {incident.severity && (
        <StatusChip label={INCIDENT_SEVERITY_LABEL[incident.severity]} tone={INCIDENT_SEVERITY_TONE[incident.severity]} />
      )}
      <StatusChip label={INCIDENT_STATUS_LABEL[incident.status]} tone={INCIDENT_STATUS_TONE[incident.status]} />
      {incident.oshaRecordable && <StatusChip label="OSHA" tone="danger" />}
      <span className="text-neutral-500">{incident.occurredAt.slice(0, 10)}</span>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Open
      </Button>
      <EditIncidentDialog open={open} onOpenChange={setOpen} incident={incident} onSaved={onSaved} />
    </li>
  );
}

function EditProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [contractValue, setContractValue] = useState(project.contractValueAmount ?? "0.00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setContractValue(project.contractValueAmount ?? "0.00");
  }, [project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(
        `/projects/${project.id}`,
        { name, status, contractValueAmount: contractValue },
        { headers: { "If-Match": String(project.updatedSeq) } },
      );
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Status">
            {() => (
              <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_TRANSITIONS[project.status].map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Contract value">
            {({ inputId }) => <CurrencyInput id={inputId} value={contractValue} onValueChange={setContractValue} />}
          </Field>
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

function NewMilestoneDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/milestones`, {
        name,
        ...(dueDate ? { dueDate } : {}),
      });
      setName("");
      setDueDate("");
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create milestone");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus />
          Add milestone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New milestone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Due date">
            {({ inputId }) => (
              <Input id={inputId} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add milestone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/tasks", {
        projectId,
        title,
        priority,
        ...(dueDate ? { dueDate } : {}),
      });
      setTitle("");
      setPriority("medium");
      setDueDate("");
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus />
          Add task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Title" required>
            {({ inputId }) => <Input id={inputId} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Priority">
            {() => (
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "urgent"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Due date">
            {({ inputId }) => (
              <Input id={inputId} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewRfiDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSubject("");
    setQuestion("");
    setDueDate("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/rfis`, {
        subject,
        question,
        ...(dueDate ? { dueDate } : {}),
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create RFI");
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
          New RFI
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>New RFI</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Subject" required>
            {({ inputId }) => (
              <Input id={inputId} required value={subject} onChange={(e) => setSubject(e.target.value)} />
            )}
          </Field>
          <Field label="Question" required>
            {({ inputId }) => (
              <Textarea id={inputId} required value={question} onChange={(e) => setQuestion(e.target.value)} />
            )}
          </Field>
          <Field label="Due date">
            {({ inputId }) => (
              <Input id={inputId} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Create RFI
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRfiDialog({
  open,
  onOpenChange,
  rfi,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rfi: Rfi;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<RfiStatus>(rfi.status);
  const [answer, setAnswer] = useState(rfi.answer ?? "");
  const [dueDate, setDueDate] = useState(rfi.dueDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(rfi.status);
    setAnswer(rfi.answer ?? "");
    setDueDate(rfi.dueDate ?? "");
  }, [rfi]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/rfis/${rfi.id}`, {
        status,
        answer: answer || null,
        dueDate: dueDate || null,
      });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update RFI");
    } finally {
      setSubmitting(false);
    }
  }

  const terminal = RFI_ALLOWED_TRANSITIONS[rfi.status].length === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>
            RFI #{rfi.number} — {rfi.subject}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{rfi.question}</p>
          <Field label="Status">
            {() => (
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as RfiStatus)}
                disabled={terminal}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RFI_ALLOWED_TRANSITIONS[rfi.status].map((s) => (
                    <SelectItem key={s} value={s}>
                      {RFI_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Answer" helperText="Required before marking as Answered">
            {({ inputId }) => (
              <Textarea
                id={inputId}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={terminal}
              />
            )}
          </Field>
          <Field label="Due date">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={terminal}
              />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting} disabled={terminal}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewIncidentDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind] = useState<IncidentKind>("incident");
  const [severity, setSeverity] = useState<IncidentSeverity | "unspecified">("unspecified");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [oshaRecordable, setOshaRecordable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind("incident");
    setSeverity("unspecified");
    setOccurredAt(new Date().toISOString().slice(0, 16));
    setLocation("");
    setDescription("");
    setOshaRecordable(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/incidents`, {
        kind,
        occurredAt: new Date(occurredAt).toISOString(),
        oshaRecordable,
        ...(severity !== "unspecified" ? { severity } : {}),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to report incident");
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
          Report incident
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>Report incident</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Kind" required>
            {() => (
              <Select value={kind} onValueChange={(value) => setKind(value as IncidentKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(INCIDENT_KIND_LABEL) as IncidentKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {INCIDENT_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Severity">
            {() => (
              <Select
                value={severity}
                onValueChange={(value) => setSeverity(value as IncidentSeverity | "unspecified")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  {(Object.keys(INCIDENT_SEVERITY_LABEL) as IncidentSeverity[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {INCIDENT_SEVERITY_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Occurred at" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                type="datetime-local"
                required
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>
          <Field label="Location">
            {({ inputId }) => <Input id={inputId} value={location} onChange={(e) => setLocation(e.target.value)} />}
          </Field>
          <Field label="Description">
            {({ inputId }) => (
              <Textarea id={inputId} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-900">
            <Checkbox checked={oshaRecordable} onCheckedChange={(checked) => setOshaRecordable(checked === true)} />
            OSHA recordable
          </label>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Report incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditIncidentDialog({
  open,
  onOpenChange,
  incident,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident: Incident;
  onSaved: () => Promise<void>;
}) {
  const [severity, setSeverity] = useState<IncidentSeverity | "unspecified">(incident.severity ?? "unspecified");
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [description, setDescription] = useState(incident.description ?? "");
  const [oshaRecordable, setOshaRecordable] = useState(incident.oshaRecordable);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);

  useEffect(() => {
    setSeverity(incident.severity ?? "unspecified");
    setStatus(incident.status);
    setDescription(incident.description ?? "");
    setOshaRecordable(incident.oshaRecordable);
  }, [incident]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/incidents/${incident.id}`, {
        status,
        oshaRecordable,
        severity: severity === "unspecified" ? undefined : severity,
        description: description || null,
      });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update incident");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>{INCIDENT_KIND_LABEL[incident.kind]}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">
            Occurred {incident.occurredAt.slice(0, 10)}
            {incident.location ? ` at ${incident.location}` : ""}
          </p>
          <Field label="Status">
            {() => (
              <Select value={status} onValueChange={(value) => setStatus(value as IncidentStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(INCIDENT_STATUS_LABEL) as IncidentStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {INCIDENT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Severity">
            {() => (
              <Select
                value={severity}
                onValueChange={(value) => setSeverity(value as IncidentSeverity | "unspecified")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  {(Object.keys(INCIDENT_SEVERITY_LABEL) as IncidentSeverity[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {INCIDENT_SEVERITY_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Description">
            {({ inputId }) => (
              <Textarea id={inputId} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-900">
            <Checkbox checked={oshaRecordable} onCheckedChange={(checked) => setOshaRecordable(checked === true)} />
            OSHA recordable
          </label>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            {incident.correctiveActionTaskId ? (
              <span className="text-sm text-neutral-500">Corrective action assigned</span>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => setRouteOpen(true)}>
                Route corrective action
              </Button>
            )}
            <Button type="submit" loading={submitting}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <RouteCorrectiveActionDialog
        open={routeOpen}
        onOpenChange={setRouteOpen}
        incidentId={incident.id}
        onRouted={async () => {
          await onSaved();
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

function RouteCorrectiveActionDialog({
  open,
  onOpenChange,
  incidentId,
  onRouted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  onRouted: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setDueDate("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/incidents/${incidentId}/route-corrective-action`, {
        title,
        ...(description ? { description } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      reset();
      onOpenChange(false);
      await onRouted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to route corrective action");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Route corrective action</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Task title" required>
            {({ inputId }) => <Input id={inputId} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Description">
            {({ inputId }) => (
              <Textarea id={inputId} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <Field label="Due date">
            {({ inputId }) => (
              <Input id={inputId} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
