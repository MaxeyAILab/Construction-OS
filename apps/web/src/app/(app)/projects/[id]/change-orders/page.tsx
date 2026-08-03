"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardTitle,
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
  Textarea,
  type StatusTone,
} from "@constructionos/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { getAccessToken } from "@/lib/session";

type ChangeOrderStatus = "draft" | "pending_client" | "approved" | "rejected" | "void";

interface Project {
  id: string;
  name: string;
  code: string;
  currency: string;
}

interface CostCode {
  id: string;
  code: string;
  name: string;
}

interface ChangeOrder {
  id: string;
  number: number;
  title: string;
  status: ChangeOrderStatus;
  costImpactAmount: string;
  priceImpactAmount: string;
  scheduleImpactDays: number;
}

const STATUS_TONE: Record<ChangeOrderStatus, StatusTone> = {
  draft: "neutral",
  pending_client: "warning",
  approved: "success",
  rejected: "danger",
  void: "danger",
};

const STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  pending_client: "Pending client",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

export default function ChangeOrdersListPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  async function reload() {
    const [projectData, costCodesData, changeOrdersData] = await Promise.all([
      apiClient.get<Project>(`/projects/${params.id}`),
      apiClient.get<CostCode[]>(`/projects/${params.id}/cost-codes`),
      apiClient.get<ChangeOrder[]>(`/projects/${params.id}/change-orders`),
    ]);
    setProject(projectData);
    setCostCodes(costCodesData);
    setChangeOrders(changeOrdersData);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load change orders"))
      .finally(() => setLoading(false));
  }, [params.id]);

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

  if (!project) return null;

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

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-neutral-900">Change orders</h1>
        <span className="font-mono text-sm text-neutral-500">{project.code}</span>
      </div>

      {error && <ErrorState variant="inline" message={error} />}

      <Card padding="default" className="p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <CardTitle>All change orders</CardTitle>
          <NewChangeOrderDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            projectId={params.id}
            costCodes={costCodes}
            onCreated={reload}
          />
        </div>
        {changeOrders.length === 0 ? (
          <EmptyState
            title="No change orders yet"
            description="Create a change order to track a cost and schedule impact through client approval."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead align="right">Cost impact</TableHead>
                <TableHead align="right">Price impact</TableHead>
                <TableHead align="right">Schedule impact</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {changeOrders.map((co) => (
                <TableRow key={co.id}>
                  <TableCell className="font-mono text-neutral-500">#{co.number}</TableCell>
                  <TableCell className="text-neutral-900">{co.title}</TableCell>
                  <TableCell>
                    <StatusChip label={STATUS_LABEL[co.status]} tone={STATUS_TONE[co.status]} />
                  </TableCell>
                  <TableCell align="right" numeric>
                    {formatMoney(co.costImpactAmount, project.currency)}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {formatMoney(co.priceImpactAmount, project.currency)}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {co.scheduleImpactDays} days
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/projects/${params.id}/change-orders/${co.id}`)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  );
}

function NewChangeOrderDialog({
  open,
  onOpenChange,
  projectId,
  costCodes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  costCodes: CostCode[];
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [priceImpactAmount, setPriceImpactAmount] = useState("0.00");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("0");
  const [costCodeId, setCostCodeId] = useState(costCodes[0]?.id ?? "");
  const [lineDescription, setLineDescription] = useState("");
  const [lineCostImpactAmount, setLineCostImpactAmount] = useState("0.00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCostCodeId((current) => current || (costCodes[0]?.id ?? ""));
  }, [costCodes]);

  function reset() {
    setTitle("");
    setReason("");
    setPriceImpactAmount("0.00");
    setScheduleImpactDays("0");
    setLineDescription("");
    setLineCostImpactAmount("0.00");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/change-orders`, {
        title,
        ...(reason ? { reason } : {}),
        priceImpactAmount,
        scheduleImpactDays: Number(scheduleImpactDays) || 0,
        lines: [{ costCodeId, description: lineDescription, costImpactAmount: lineCostImpactAmount }],
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create change order");
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
        <Button variant="secondary" size="sm" disabled={costCodes.length === 0}>
          <Plus />
          New change order
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>New change order</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Title" required>
            {({ inputId }) => <Input id={inputId} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Reason">
            {({ inputId }) => <Textarea id={inputId} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price impact">
              {({ inputId }) => (
                <CurrencyInput id={inputId} value={priceImpactAmount} onValueChange={setPriceImpactAmount} />
              )}
            </Field>
            <Field label="Schedule impact (days)">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  type="number"
                  step="1"
                  value={scheduleImpactDays}
                  onChange={(e) => setScheduleImpactDays(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="text-sm font-medium text-neutral-900">Initial line</p>
          <Field label="Cost code" required>
            {() => (
              <Select value={costCodeId} onValueChange={setCostCodeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {costCodes.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Description" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                required
                value={lineDescription}
                onChange={(e) => setLineDescription(e.target.value)}
              />
            )}
          </Field>
          <Field label="Cost impact" helperText="Negative for a deductive change order">
            {({ inputId }) => (
              <CurrencyInput id={inputId} value={lineCostImpactAmount} onValueChange={setLineCostImpactAmount} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting} disabled={!costCodeId}>
              Create change order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
