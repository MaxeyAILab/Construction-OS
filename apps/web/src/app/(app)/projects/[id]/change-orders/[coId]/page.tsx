"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
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

interface ChangeOrderLine {
  id: string;
  costCodeId: string;
  description: string;
  costImpactAmount: string;
}

interface ChangeOrder {
  id: string;
  number: number;
  title: string;
  reason: string | null;
  status: ChangeOrderStatus;
  costImpactAmount: string;
  priceImpactAmount: string;
  scheduleImpactDays: number;
  lines: ChangeOrderLine[];
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

export default function ChangeOrderDetailPage() {
  const params = useParams<{ id: string; coId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [co, setCo] = useState<ChangeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [lineOpen, setLineOpen] = useState(false);

  async function reload() {
    const [projectData, costCodesData, coData] = await Promise.all([
      apiClient.get<Project>(`/projects/${params.id}`),
      apiClient.get<CostCode[]>(`/projects/${params.id}/cost-codes`),
      apiClient.get<ChangeOrder>(`/change-orders/${params.coId}`),
    ]);
    setProject(projectData);
    setCostCodes(costCodesData);
    setCo(coData);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load change order"))
      .finally(() => setLoading(false));
  }, [params.id, params.coId]);

  async function runAction(action: "submit-to-client" | "approve" | "reject" | "void") {
    setActing(action);
    setActionError(null);
    try {
      await apiClient.post(`/change-orders/${params.coId}/${action}`, {});
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Failed to ${action.replace(/-/g, " ")}`);
    } finally {
      setActing(null);
    }
  }

  async function deleteLine(lineId: string) {
    setActionError(null);
    try {
      await apiClient.delete(`/change-orders/${params.coId}/lines/${lineId}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to remove line");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (error && !co) {
    return <ErrorState variant="page" message={error} onRetry={() => location.reload()} />;
  }

  if (!project || !co) return null;

  const isDraft = co.status === "draft";
  const costCodeById = new Map(costCodes.map((cc) => [cc.id, cc]));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <button
        type="button"
        onClick={() => router.push(`/projects/${params.id}/change-orders`)}
        className="flex w-fit items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" />
        Change orders
      </button>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-neutral-900">
              #{co.number} — {co.title}
            </h1>
            <StatusChip label={STATUS_LABEL[co.status]} tone={STATUS_TONE[co.status]} />
          </div>
          {co.reason && <p className="text-sm text-neutral-500">{co.reason}</p>}
        </div>
        <div className="flex items-center gap-2">
          {co.status === "draft" && (
            <>
              <Button variant="secondary" size="sm" loading={acting === "void"} onClick={() => runAction("void")}>
                Void
              </Button>
              <Button loading={acting === "submit-to-client"} onClick={() => runAction("submit-to-client")}>
                Submit to client
              </Button>
            </>
          )}
          {co.status === "pending_client" && (
            <>
              <Button variant="secondary" size="sm" loading={acting === "void"} onClick={() => runAction("void")}>
                Void
              </Button>
              <Button
                variant="secondary"
                loading={acting === "reject"}
                onClick={() => runAction("reject")}
              >
                Reject
              </Button>
              <Button loading={acting === "approve"} onClick={() => runAction("approve")}>
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      {actionError && <ErrorState variant="inline" message={actionError} />}

      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Cost impact" value={formatMoney(co.costImpactAmount, project.currency)} />
        <MetricCard label="Price impact" value={formatMoney(co.priceImpactAmount, project.currency)} />
        <MetricCard label="Schedule impact" value={`${co.scheduleImpactDays} days`} />
      </div>

      <Card padding="default" className="p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <CardTitle>Lines</CardTitle>
          {isDraft && (
            <NewLineDialog
              open={lineOpen}
              onOpenChange={setLineOpen}
              changeOrderId={co.id}
              costCodes={costCodes}
              onCreated={reload}
            />
          )}
        </div>
        {co.lines.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No lines yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead align="right">Cost impact</TableHead>
                {isDraft && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {co.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-mono text-neutral-500">{costCodeById.get(line.costCodeId)?.code ?? line.costCodeId}</span>{" "}
                    <span className="text-neutral-900">{costCodeById.get(line.costCodeId)?.name}</span>
                  </TableCell>
                  <TableCell className="text-neutral-900">{line.description}</TableCell>
                  <TableCell align="right" numeric>
                    {formatMoney(line.costImpactAmount, project.currency)}
                  </TableCell>
                  {isDraft && (
                    <TableCell align="right">
                      <Button variant="ghost" size="sm" onClick={() => deleteLine(line.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  );
}

function NewLineDialog({
  open,
  onOpenChange,
  changeOrderId,
  costCodes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeOrderId: string;
  costCodes: CostCode[];
  onCreated: () => Promise<void>;
}) {
  const [costCodeId, setCostCodeId] = useState(costCodes[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [costImpactAmount, setCostImpactAmount] = useState("0.00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCostCodeId((current) => current || (costCodes[0]?.id ?? ""));
  }, [costCodes]);

  function reset() {
    setDescription("");
    setCostImpactAmount("0.00");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/change-orders/${changeOrderId}/lines`, { costCodeId, description, costImpactAmount });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add line");
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
          Add line
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New line</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <Input id={inputId} required value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <Field label="Cost impact" helperText="Negative for a deductive change order">
            {({ inputId }) => (
              <CurrencyInput id={inputId} value={costImpactAmount} onValueChange={setCostImpactAmount} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting} disabled={!costCodeId}>
              Add line
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
