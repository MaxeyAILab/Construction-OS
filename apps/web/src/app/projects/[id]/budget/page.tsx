"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
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
} from "@constructionos/ui";
import { apiClient, ApiError } from "../../../../lib/api-client";
import { getAccessToken } from "../../../../lib/session";

type CostCodeKind = "labor" | "material" | "equipment" | "subcontract" | "other";

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
  kind: CostCodeKind;
}

interface BudgetLine {
  id: string;
  costCodeId: string;
  originalAmount: string;
  revisedAmount: string;
  committedAmount: string;
  actualAmount: string;
  forecastToCompleteAmount: string;
  forecastAtCompletionAmount: string;
}

interface Budget {
  id: string;
  status: "active" | "locked" | "superseded";
  currency: string;
  lines: BudgetLine[];
}

interface FinancialSummary {
  revisedTotal: string;
  committedTotal: string;
  actualTotal: string;
  costToComplete: string;
  forecastAtCompletion: string;
  variance: string;
  marginAmount: string | null;
  marginPct: number | null;
}

interface CostTransaction {
  id: string;
  costCodeId: string;
  source: string;
  txnDate: string;
  amount: string;
  memo: string | null;
}

const KIND_LABEL: Record<CostCodeKind, string> = {
  labor: "Labor",
  material: "Material",
  equipment: "Equipment",
  subcontract: "Subcontract",
  other: "Other",
};

function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

export default function ProjectBudgetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [transactions, setTransactions] = useState<CostTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingBudget, setCreatingBudget] = useState(false);
  const [costCodeOpen, setCostCodeOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);

  async function reload() {
    const [projectData, costCodesData, summaryData, transactionsData, budgetData] = await Promise.all([
      apiClient.get<Project>(`/projects/${params.id}`),
      apiClient.get<CostCode[]>(`/projects/${params.id}/cost-codes`),
      apiClient.get<FinancialSummary>(`/projects/${params.id}/financial-summary`),
      apiClient.get<CostTransaction[]>(`/projects/${params.id}/cost-transactions`),
      apiClient.get<Budget>(`/projects/${params.id}/budget`).catch((err) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    ]);
    setProject(projectData);
    setCostCodes(costCodesData);
    setSummary(summaryData);
    setTransactions(transactionsData);
    setBudget(budgetData);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load budget"))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function createBudget() {
    if (!project) return;
    setCreatingBudget(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${params.id}/budget`, { currency: project.currency });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create budget");
    } finally {
      setCreatingBudget(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (error && !project) {
    return <ErrorState variant="page" message={error} onRetry={() => location.reload()} />;
  }

  if (!project || !summary) return null;

  const currency = budget?.currency ?? project.currency;
  const costCodeById = new Map(costCodes.map((cc) => [cc.id, cc]));
  const budgetedCostCodeIds = new Set((budget?.lines ?? []).map((line) => line.costCodeId));
  const availableCostCodes = costCodes.filter((cc) => !budgetedCostCodeIds.has(cc.id));

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
        <h1 className="text-xl font-semibold text-neutral-900">Budget &amp; Cost Ledger</h1>
        <span className="font-mono text-sm text-neutral-500">{project.code}</span>
      </div>

      {error && <ErrorState variant="inline" message={error} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Revised budget" value={formatMoney(summary.revisedTotal, currency)} />
        <MetricCard label="Committed" value={formatMoney(summary.committedTotal, currency)} />
        <MetricCard label="Actual" value={formatMoney(summary.actualTotal, currency)} />
        <MetricCard label="Cost to complete" value={formatMoney(summary.costToComplete, currency)} />
        <MetricCard label="Forecast at completion" value={formatMoney(summary.forecastAtCompletion, currency)} />
        <MetricCard label="Variance" value={formatMoney(summary.variance, currency)} />
        <MetricCard
          label="Margin"
          value={formatMoney(summary.marginAmount, currency)}
          {...(summary.marginPct !== null
            ? {
                delta: {
                  value: `${summary.marginPct.toFixed(1)}%`,
                  direction: summary.marginPct >= 0 ? ("up" as const) : ("down" as const),
                  tone: summary.marginPct >= 0 ? ("success" as const) : ("danger" as const),
                },
              }
            : {})}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Cost codes</CardTitle>
          <NewCostCodeDialog open={costCodeOpen} onOpenChange={setCostCodeOpen} projectId={params.id} onCreated={reload} />
        </CardHeader>
        {costCodes.length === 0 ? (
          <p className="text-sm text-neutral-500">No cost codes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {costCodes.map((cc) => (
              <li key={cc.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-neutral-500">{cc.code}</span>
                <span className="text-neutral-900">{cc.name}</span>
                <StatusChip label={KIND_LABEL[cc.kind]} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card {...(budget ? { padding: "default" as const, className: "p-0" } : {})}>
        {budget ? (
          <>
            <div className="flex items-center justify-between p-4 pb-0">
              <CardTitle>Budget lines</CardTitle>
              <NewBudgetLineDialog
                open={lineOpen}
                onOpenChange={setLineOpen}
                budgetId={budget.id}
                costCodes={availableCostCodes}
                onCreated={reload}
              />
            </div>
            {budget.lines.length === 0 ? (
              <p className="p-4 text-sm text-neutral-500">No budget lines yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cost code</TableHead>
                    <TableHead align="right">Original</TableHead>
                    <TableHead align="right">Revised</TableHead>
                    <TableHead align="right">Committed</TableHead>
                    <TableHead align="right">Actual</TableHead>
                    <TableHead align="right">Cost to complete</TableHead>
                    <TableHead align="right">Forecast at completion</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budget.lines.map((line) => (
                    <BudgetLineRow
                      key={line.id}
                      line={line}
                      costCode={costCodeById.get(line.costCodeId)}
                      currency={currency}
                      budgetId={budget.id}
                      onSaved={reload}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : (
          <EmptyState
            title="No budget yet"
            description="Create a budget to start tracking cost codes against original and revised amounts."
            action={
              <Button size="sm" onClick={createBudget} loading={creatingBudget}>
                Create budget
              </Button>
            }
          />
        )}
      </Card>

      <Card padding="default" className="p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <CardTitle>Cost transactions</CardTitle>
          <NewCostTransactionDialog
            open={txnOpen}
            onOpenChange={setTxnOpen}
            projectId={params.id}
            costCodes={costCodes}
            onCreated={reload}
          />
        </div>
        {transactions.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No cost transactions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead>Source</TableHead>
                <TableHead align="right">Amount</TableHead>
                <TableHead>Memo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell>{txn.txnDate}</TableCell>
                  <TableCell className="font-mono text-neutral-500">
                    {costCodeById.get(txn.costCodeId)?.code ?? txn.costCodeId}
                  </TableCell>
                  <TableCell>{txn.source}</TableCell>
                  <TableCell align="right" numeric>
                    {formatMoney(txn.amount, currency)}
                  </TableCell>
                  <TableCell className="text-neutral-500">{txn.memo ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  );
}

function BudgetLineRow({
  line,
  costCode,
  currency,
  budgetId,
  onSaved,
}: {
  line: BudgetLine;
  costCode: CostCode | undefined;
  currency: string;
  budgetId: string;
  onSaved: () => Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [originalAmount, setOriginalAmount] = useState(line.originalAmount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOriginalAmount(line.originalAmount);
  }, [line.originalAmount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/budgets/${budgetId}/lines/${line.id}`, { originalAmount });
      setEditOpen(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update budget line");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-neutral-500">{costCode?.code ?? line.costCodeId}</span>{" "}
        <span className="text-neutral-900">{costCode?.name}</span>
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.originalAmount, currency)}
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.revisedAmount, currency)}
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.committedAmount, currency)}
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.actualAmount, currency)}
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.forecastToCompleteAmount, currency)}
      </TableCell>
      <TableCell align="right" numeric>
        {formatMoney(line.forecastAtCompletionAmount, currency)}
      </TableCell>
      <TableCell align="right">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent size="form">
            <DialogHeader>
              <DialogTitle>Edit budget line</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="Original amount">
                {({ inputId }) => (
                  <CurrencyInput id={inputId} value={originalAmount} onValueChange={setOriginalAmount} />
                )}
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
      </TableCell>
    </TableRow>
  );
}

function NewCostCodeDialog({
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
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CostCodeKind>("labor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCode("");
    setName("");
    setKind("labor");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/cost-codes`, { code, name, kind });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create cost code");
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
          Add cost code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cost code</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Code" required helperText="Unique per project">
            {({ inputId }) => <Input id={inputId} required value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Kind">
            {() => (
              <Select value={kind} onValueChange={(value) => setKind(value as CostCodeKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as CostCodeKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add cost code
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewBudgetLineDialog({
  open,
  onOpenChange,
  budgetId,
  costCodes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: string;
  costCodes: CostCode[];
  onCreated: () => Promise<void>;
}) {
  const [costCodeId, setCostCodeId] = useState(costCodes[0]?.id ?? "");
  const [originalAmount, setOriginalAmount] = useState("0.00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCostCodeId(costCodes[0]?.id ?? "");
  }, [costCodes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/budgets/${budgetId}/lines`, { costCodeId, originalAmount });
      setOriginalAmount("0.00");
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add budget line");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={costCodes.length === 0}>
          <Plus />
          Add line
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New budget line</DialogTitle>
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
          <Field label="Original amount">
            {({ inputId }) => (
              <CurrencyInput id={inputId} value={originalAmount} onValueChange={setOriginalAmount} />
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

function NewCostTransactionDialog({
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
  const [costCodeId, setCostCodeId] = useState(costCodes[0]?.id ?? "");
  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("0.00");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCostCodeId((current) => current || (costCodes[0]?.id ?? ""));
  }, [costCodes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectId}/cost-transactions`, {
        costCodeId,
        txnDate,
        amount,
        ...(memo ? { memo } : {}),
      });
      setAmount("0.00");
      setMemo("");
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post cost transaction");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={costCodes.length === 0}>
          <Plus />
          Post transaction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post cost transaction</DialogTitle>
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
          <Field label="Date" required>
            {({ inputId }) => (
              <Input id={inputId} type="date" required value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
            )}
          </Field>
          <Field label="Amount">
            {({ inputId }) => <CurrencyInput id={inputId} value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Memo">
            {({ inputId }) => <Input id={inputId} value={memo} onChange={(e) => setMemo(e.target.value)} />}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting} disabled={!costCodeId}>
              Post transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
