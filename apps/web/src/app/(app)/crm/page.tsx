"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
  Textarea,
  type StatusTone,
} from "@constructionos/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { getAccessToken } from "@/lib/session";

interface PipelineStage {
  id: string;
  name: string;
  displayOrder: number;
}

type ContactKind = "client" | "architect" | "engineer" | "subcontractor" | "vendor" | "other";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  kind: ContactKind | null;
}

type OpportunityStatus = "open" | "won" | "lost";

interface Opportunity {
  id: string;
  name: string;
  contactId: string | null;
  stageId: string;
  status: OpportunityStatus;
  expectedValueAmount: string | null;
  probability: string | null;
  expectedCloseDate: string | null;
  wonProjectId: string | null;
  lostReason: string | null;
}

const STATUS_TONE: Record<OpportunityStatus, StatusTone> = {
  open: "neutral",
  won: "success",
  lost: "danger",
};

function formatMoney(amount: string | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount));
}

export default function CrmPage() {
  const router = useRouter();
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageOpen, setStageOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [opportunityOpen, setOpportunityOpen] = useState(false);

  async function reload() {
    const [stagesData, contactsData, opportunitiesData] = await Promise.all([
      apiClient.get<PipelineStage[]>("/crm/pipeline-stages"),
      apiClient.get<Contact[]>("/crm/contacts?limit=100"),
      apiClient.get<Opportunity[]>("/crm/opportunities?limit=100"),
    ]);
    setStages(stagesData);
    setContacts(contactsData);
    setOpportunities(opportunitiesData);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load CRM"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const openOpportunities = opportunities.filter((o) => o.status === "open");
  const closedOpportunities = opportunities.filter((o) => o.status !== "open");

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-neutral-900">CRM</h1>

      {error && <ErrorState variant="inline" message={error} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Pipeline stages</CardTitle>
          <NewStageDialog open={stageOpen} onOpenChange={setStageOpen} stages={stages} onCreated={reload} />
        </CardHeader>
        {stages.length === 0 ? (
          <p className="text-sm text-neutral-500">No pipeline stages yet — add one to start tracking opportunities.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {stages.map((stage) => (
              <li key={stage.id}>
                <StatusChip label={stage.name} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-4">
          <CardTitle>Contacts</CardTitle>
          <NewContactDialog open={contactOpen} onOpenChange={setContactOpen} onCreated={reload} />
        </CardHeader>
        {contacts.length === 0 ? (
          <p className="text-sm text-neutral-500">No contacts yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex items-center gap-2 text-sm">
                <span className="text-neutral-900">
                  {contact.firstName} {contact.lastName}
                </span>
                {contact.kind && <StatusChip label={contact.kind} tone="neutral" />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="default" className="p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <CardTitle>Pipeline</CardTitle>
          <NewOpportunityDialog
            open={opportunityOpen}
            onOpenChange={setOpportunityOpen}
            stages={stages}
            contacts={contacts}
            onCreated={reload}
          />
        </div>
        <div className="flex gap-4 overflow-x-auto p-4">
          {stages.length === 0 ? (
            <p className="text-sm text-neutral-500">Add a pipeline stage to see the board.</p>
          ) : (
            stages
              .slice()
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((stage) => (
                <div key={stage.id} className="flex w-72 shrink-0 flex-col gap-2">
                  <h3 className="text-sm font-medium text-neutral-500">{stage.name}</h3>
                  <div className="flex flex-col gap-2">
                    {openOpportunities
                      .filter((o) => o.stageId === stage.id)
                      .map((opp) => (
                        <OpportunityCard
                          key={opp.id}
                          opportunity={opp}
                          stages={stages}
                          contacts={contacts}
                          contactName={
                            opp.contactId && contactById.get(opp.contactId)
                              ? `${contactById.get(opp.contactId)!.firstName} ${contactById.get(opp.contactId)!.lastName}`
                              : null
                          }
                          onSaved={reload}
                        />
                      ))}
                    {openOpportunities.filter((o) => o.stageId === stage.id).length === 0 && (
                      <p className="text-xs text-neutral-500">No opportunities.</p>
                    )}
                  </div>
                </div>
              ))
          )}
        </div>
      </Card>

      {closedOpportunities.length > 0 && (
        <Card>
          <CardTitle className="pb-4">Closed opportunities</CardTitle>
          <ul className="flex flex-col gap-2">
            {closedOpportunities.map((opp) => (
              <li key={opp.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-neutral-900">{opp.name}</span>
                <StatusChip label={opp.status} tone={STATUS_TONE[opp.status]} />
                {opp.status === "won" && opp.wonProjectId && (
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${opp.wonProjectId}`)}>
                    View project
                  </Button>
                )}
                {opp.status === "lost" && opp.lostReason && (
                  <span className="text-neutral-500">{opp.lostReason}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function OpportunityCard({
  opportunity,
  stages,
  contacts,
  contactName,
  onSaved,
}: {
  opportunity: Opportunity;
  stages: PipelineStage[];
  contacts: Contact[];
  contactName: string | null;
  onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [loseOpen, setLoseOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-0 p-3">
      <span className="text-sm font-medium text-neutral-900">{opportunity.name}</span>
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{formatMoney(opportunity.expectedValueAmount)}</span>
        {opportunity.probability && <span>{Number(opportunity.probability)}%</span>}
      </div>
      {contactName && <span className="text-xs text-neutral-500">{contactName}</span>}
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWinOpen(true)}>
          Win
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setLoseOpen(true)}>
          Lose
        </Button>
      </div>
      <EditOpportunityDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        opportunity={opportunity}
        stages={stages}
        contacts={contacts}
        onSaved={onSaved}
      />
      <WinOpportunityDialog
        open={winOpen}
        onOpenChange={setWinOpen}
        opportunity={opportunity}
        onWon={onSaved}
        onViewProject={(projectId) => router.push(`/projects/${projectId}`)}
      />
      <LoseOpportunityDialog open={loseOpen} onOpenChange={setLoseOpen} opportunity={opportunity} onSaved={onSaved} />
    </div>
  );
}

function NewStageDialog({
  open,
  onOpenChange,
  stages,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: PipelineStage[];
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const nextOrder = stages.reduce((max, s) => Math.max(max, s.displayOrder), 0) + 1;
      await apiClient.post("/crm/pipeline-stages", { name, displayOrder: nextOrder });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add stage");
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
          Add stage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pipeline stage</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add stage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewContactDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<ContactKind>("client");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setKind("client");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/crm/contacts", {
        firstName,
        lastName,
        kind,
        ...(email ? { email } : {}),
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add contact");
    } finally {
      setSubmitting(false);
    }
  }

  const kinds: ContactKind[] = ["client", "architect", "engineer", "subcontractor", "vendor", "other"];

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
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="First name" required>
            {({ inputId }) => (
              <Input id={inputId} required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            )}
          </Field>
          <Field label="Last name" required>
            {({ inputId }) => (
              <Input id={inputId} required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            )}
          </Field>
          <Field label="Email">
            {({ inputId }) => (
              <Input id={inputId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field label="Kind">
            {() => (
              <Select value={kind} onValueChange={(value) => setKind(value as ContactKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NO_CONTACT = "none";

function NewOpportunityDialog({
  open,
  onOpenChange,
  stages,
  contacts,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: PipelineStage[];
  contacts: Contact[];
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [contactId, setContactId] = useState<string>(NO_CONTACT);
  const [expectedValueAmount, setExpectedValueAmount] = useState("0.00");
  const [probability, setProbability] = useState("0.00");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStageId((current) => current || (stages[0]?.id ?? ""));
  }, [stages]);

  function reset() {
    setName("");
    setContactId(NO_CONTACT);
    setExpectedValueAmount("0.00");
    setProbability("0.00");
    setExpectedCloseDate("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/crm/opportunities", {
        name,
        stageId,
        expectedValueAmount,
        probability,
        ...(contactId !== NO_CONTACT ? { contactId } : {}),
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add opportunity");
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
        <Button variant="secondary" size="sm" disabled={stages.length === 0}>
          <Plus />
          New opportunity
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Stage" required>
            {() => (
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Contact">
            {() => (
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTACT}>None</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Expected value">
              {({ inputId }) => (
                <CurrencyInput id={inputId} value={expectedValueAmount} onValueChange={setExpectedValueAmount} />
              )}
            </Field>
            <Field label="Probability">
              {({ inputId }) => (
                <CurrencyInput
                  id={inputId}
                  currencySymbol="%"
                  value={probability}
                  onValueChange={setProbability}
                />
              )}
            </Field>
          </div>
          <Field label="Expected close date">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting} disabled={!stageId}>
              Add opportunity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditOpportunityDialog({
  open,
  onOpenChange,
  opportunity,
  stages,
  contacts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity;
  stages: PipelineStage[];
  contacts: Contact[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(opportunity.name);
  const [stageId, setStageId] = useState(opportunity.stageId);
  const [contactId, setContactId] = useState(opportunity.contactId ?? NO_CONTACT);
  const [expectedValueAmount, setExpectedValueAmount] = useState(opportunity.expectedValueAmount ?? "0.00");
  const [probability, setProbability] = useState(opportunity.probability ?? "0.00");
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity.expectedCloseDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(opportunity.name);
    setStageId(opportunity.stageId);
    setContactId(opportunity.contactId ?? NO_CONTACT);
    setExpectedValueAmount(opportunity.expectedValueAmount ?? "0.00");
    setProbability(opportunity.probability ?? "0.00");
    setExpectedCloseDate(opportunity.expectedCloseDate ?? "");
  }, [opportunity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/crm/opportunities/${opportunity.id}`, {
        name,
        stageId,
        expectedValueAmount,
        probability,
        contactId: contactId === NO_CONTACT ? null : contactId,
        expectedCloseDate: expectedCloseDate || null,
      });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update opportunity");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="form">
        <DialogHeader>
          <DialogTitle>Edit opportunity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Stage" required>
            {() => (
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Contact">
            {() => (
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTACT}>None</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Expected value">
              {({ inputId }) => (
                <CurrencyInput id={inputId} value={expectedValueAmount} onValueChange={setExpectedValueAmount} />
              )}
            </Field>
            <Field label="Probability">
              {({ inputId }) => (
                <CurrencyInput
                  id={inputId}
                  currencySymbol="%"
                  value={probability}
                  onValueChange={setProbability}
                />
              )}
            </Field>
          </div>
          <Field label="Expected close date">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
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
  );
}

function WinOpportunityDialog({
  open,
  onOpenChange,
  opportunity,
  onWon,
  onViewProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity;
  onWon: () => Promise<void>;
  onViewProject: (projectId: string) => void;
}) {
  const [code, setCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wonProjectId, setWonProjectId] = useState<string | null>(null);

  function reset() {
    setCode("");
    setStartDate("");
    setError(null);
    setWonProjectId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient.post<{ opportunity: Opportunity; project: { id: string } }>(
        `/crm/opportunities/${opportunity.id}/win`,
        { project: { code, ...(startDate ? { startDate } : {}) } },
      );
      setWonProjectId(result.project.id);
      await onWon();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to mark opportunity won");
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
          <DialogTitle>Win opportunity — {opportunity.name}</DialogTitle>
        </DialogHeader>
        {wonProjectId ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-700">Opportunity marked won. Project created.</p>
            <DialogFooter>
              <Button onClick={() => onViewProject(wonProjectId)}>View project</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Project code" required helperText="Unique per project">
              {({ inputId }) => (
                <Input id={inputId} required value={code} onChange={(e) => setCode(e.target.value)} />
              )}
            </Field>
            <Field label="Start date">
              {({ inputId }) => (
                <Input id={inputId} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              )}
            </Field>
            {error && <ErrorState variant="inline" message={error} />}
            <DialogFooter>
              <Button type="submit" loading={submitting}>
                Mark won
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LoseOpportunityDialog({
  open,
  onOpenChange,
  opportunity,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity;
  onSaved: () => Promise<void>;
}) {
  const [lostReason, setLostReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLostReason("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/crm/opportunities/${opportunity.id}/lose`, { lostReason });
      reset();
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to mark opportunity lost");
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
          <DialogTitle>Lose opportunity — {opportunity.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Reason" required>
            {({ inputId }) => (
              <Textarea id={inputId} required value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <DialogFooter>
            <Button type="submit" loading={submitting}>
              Mark lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
