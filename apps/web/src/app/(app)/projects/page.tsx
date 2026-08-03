"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Button,
  Card,
  CurrencyInput,
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
}

// ui-design-system.md §7: map each domain status to a StatusTone once,
// here, rather than ad hoc per render.
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

function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number(amount),
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function reload(status: ProjectStatus | "all") {
    const query = status === "all" ? "" : `?status=${status}`;
    const list = await apiClient.get<Project[]>(`/projects${query}`);
    setProjects(list);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload(statusFilter)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  if (loading) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>
        <div className="flex items-center gap-3">
          <Link href="/admin/roles" className="text-sm text-neutral-500 hover:text-neutral-900">
            Roles &amp; permissions
          </Link>
          <NewProjectDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onCreated={(project) => router.push(`/projects/${project.id}`)}
          />
        </div>
      </div>

      {error && <ErrorState variant="inline" message={error} />}

      <Field label="Status" className="max-w-[200px]">
        {() => (
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as ProjectStatus | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABEL[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            description="Create your first project to get started."
            action={
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                New project
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padding="default" className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead align="right">Contract value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <TableCell className="font-mono text-neutral-500">{project.code}</TableCell>
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>
                    <StatusChip label={STATUS_LABEL[project.status]} tone={STATUS_TONE[project.status]} />
                  </TableCell>
                  <TableCell>{project.startDate ?? "—"}</TableCell>
                  <TableCell align="right" numeric>
                    {formatMoney(project.contractValueAmount, project.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [contractValue, setContractValue] = useState("0.00");
  const [startDate, setStartDate] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCode("");
    setCurrency("USD");
    setContractValue("0.00");
    setStartDate("");
    setTargetEndDate("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const project = await apiClient.post<Project>("/projects", {
        name,
        code,
        currency,
        // 0.00 reads as "not entered" in this form — omit rather than
        // sending an explicit zero contract value.
        ...(contractValue !== "0.00" ? { contractValueAmount: contractValue } : {}),
        ...(startDate ? { startDate } : {}),
        ...(targetEndDate ? { targetEndDate } : {}),
      });
      reset();
      onOpenChange(false);
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project");
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
        <Button size="sm">
          <Plus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required className="col-span-2">
              {({ inputId }) => (
                <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Code" required helperText="Unique per company">
              {({ inputId }) => (
                <Input id={inputId} required value={code} onChange={(e) => setCode(e.target.value)} />
              )}
            </Field>
            <Field label="Currency">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              )}
            </Field>
            <Field label="Contract value">
              {({ inputId }) => <CurrencyInput id={inputId} value={contractValue} onValueChange={setContractValue} />}
            </Field>
            <Field label="Start date">
              {({ inputId }) => (
                <Input id={inputId} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              )}
            </Field>
            <Field label="Target end date">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  type="date"
                  value={targetEndDate}
                  onChange={(e) => setTargetEndDate(e.target.value)}
                />
              )}
            </Field>
          </div>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
