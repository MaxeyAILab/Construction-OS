import { cleanup, render, screen } from "@testing-library/react";
import { AlertTriangle } from "lucide-react";
import { afterEach, describe, it } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { Avatar, AvatarFallback } from "../avatar";
import { Button } from "../button";
import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { Checkbox } from "../checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../dialog";
import { EmptyState } from "../empty-state";
import { ErrorState } from "../error-state";
import { Field } from "../field";
import { Input } from "../input";
import { MetricCard } from "../metric-card";
import { RadioGroup, RadioGroupItem } from "../radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { StatusChip } from "../status-chip";
import { Switch } from "../switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";

// Roadmap Phase 1A success metric: "a11y CI green." axe-core in jsdom
// validates DOM structure/semantics (labels, roles, aria, focus order) —
// it can't do real color-contrast measurement without a rendering engine,
// so that half of WCAG AA still needs a real-browser pass (flagged as a
// follow-up, ui-design-system.md §8's "manual screen-reader pass" too).
describe("a11y: core components", () => {
  afterEach(cleanup);

  it("Button (every variant)", async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ai">AI</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("Field + Input, including an error state", async () => {
    const { container } = render(
      <div>
        <Field label="Project name" helperText="Shown to the whole team">
          {({ inputId, describedBy }) => (
            <Input id={inputId} aria-describedby={describedBy} placeholder="e.g. Riverside Tower" />
          )}
        </Field>
        <Field label="Required-by date" error="Required-by date must be after order date" required>
          {({ inputId, describedBy }) => (
            <Input id={inputId} aria-describedby={describedBy} invalid />
          )}
        </Field>
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("Checkbox / RadioGroup / Switch with associated labels", async () => {
    const { container } = render(
      <div>
        <label>
          <Checkbox aria-label="Accept terms" /> Accept terms
        </label>
        <RadioGroup aria-label="Scope" defaultValue="company">
          <label>
            <RadioGroupItem value="company" /> Company
          </label>
          <label>
            <RadioGroupItem value="project" /> Project
          </label>
        </RadioGroup>
        <label>
          <Switch aria-label="Enable notifications" /> Enable notifications
        </label>
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("Card / MetricCard / StatusChip", async () => {
    const { container } = render(
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Budget summary</CardTitle>
          </CardHeader>
          <CardContent>Details</CardContent>
        </Card>
        <MetricCard
          label="Margin"
          value="18.2%"
          delta={{ value: "+1.4pt", direction: "up", tone: "success" }}
        />
        <StatusChip label="Over budget" tone="danger" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("Avatar / EmptyState / ErrorState", async () => {
    const { container } = render(
      <div>
        <Avatar>
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
        <EmptyState
          icon={AlertTriangle}
          title="No purchase orders yet"
          description="Create one or draft from budget needs."
        />
        <ErrorState variant="section" message="Could not load budget lines." traceId="abc-123" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("Table with sortable header and row selection state", async () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortDirection="asc" onSort={() => {}}>
              Cost code
            </TableHead>
            <TableHead align="right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow selected>
            <TableCell>03-300</TableCell>
            <TableCell numeric>$12,400.00</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    await expectNoA11yViolations(container);
  });

  it("Tabs", async () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Overview</TabsTrigger>
          <TabsTrigger value="b">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Overview content</TabsContent>
        <TabsContent value="b">Activity content</TabsContent>
      </Tabs>,
    );
    await expectNoA11yViolations(container);
  });

  it("Dialog (open) — Radix portals into document.body", async () => {
    render(
      <Dialog defaultOpen>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role</DialogTitle>
            <DialogDescription>This can't be undone.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    await expectNoA11yViolations(document.body);
  });

  it("Select (open) — Radix portals into document.body", async () => {
    // Wrapped in <main>: axe's "region" rule requires all page content sit
    // inside a landmark, which is an app-shell concern (the real app's
    // layout always provides one) — Dialog's test doesn't need this
    // because Radix aria-hides the rest of the page while a modal is open.
    render(
      <main>
        <Select defaultOpen>
          <SelectTrigger aria-label="Cost code">
            <SelectValue placeholder="Select a cost code" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="03-300">03-300 Concrete</SelectItem>
            <SelectItem value="05-100">05-100 Structural steel</SelectItem>
          </SelectContent>
        </Select>
      </main>,
    );
    await screen.findByRole("listbox");
    // "region" is a known axe false-positive for portaled overlay content
    // (role="listbox") tested in isolation: floating menus/comboboxes are
    // conventionally exempt from the landmark requirement (unlike Dialog,
    // Radix doesn't aria-hide the rest of the page behind a listbox,
    // which is why that test above doesn't need this).
    await expectNoA11yViolations(document.body, ["region"]);
  });
});
