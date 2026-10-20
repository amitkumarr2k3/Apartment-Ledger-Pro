import { useId, useState } from "react";
import { Plus, Save } from "lucide-react";
import { useExpenseInfoSettings, saveExpenseInfoSettings, useExpenseTree } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ORIGINAL_NAME = "One Time Operational Procurement";

export function ProcurementSettings() {
  const fieldId = useId();
  const { data, isLoading, error: loadError, refetch } = useExpenseInfoSettings();
  const { data: expenseTree = [] } = useExpenseTree();
  const [draft, setDraft] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const text = draft ?? (data?.procurementNames ?? [ORIGINAL_NAME]).join("\n");
  const names = text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const procurementNames = names.filter(
    (name, index) =>
      names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index,
  );
  const validationError =
    names.length > 50
      ? "Use at most 50 category names."
      : names.some((name) => name.length > 200)
        ? "Each category name must be 200 characters or fewer."
        : names.length === 0
          ? "Enter at least one category name."
          : "";
  const availableNames = [...new Set(expenseTree.map((category) => category.name))]
    .filter(
      (name) => !procurementNames.some((existing) => existing.toLowerCase() === name.toLowerCase()),
    )
    .sort((first, second) => first.localeCompare(second));

  function updateDraft(value: string) {
    setDraft(value);
    setError("");
    setStatus("");
  }

  async function save() {
    if (validationError || saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    let persisted = false;
    try {
      const saved = await saveExpenseInfoSettings(procurementNames);
      persisted = true;
      setDraft(saved.procurementNames.join("\n"));
      const refreshed = await refetch();
      if (refreshed.isError) throw refreshed.error;
      setDraft(null);
      setStatus("Procurement category names saved.");
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : "Please try again.";
      setError(
        `${persisted ? "Names were saved, but refreshing failed." : "Names could not be saved."} ${detail}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="mt-6 space-y-4 border-t pt-6">
      <div>
        <h2 id={`${fieldId}-heading`} className="text-base font-semibold">
          Procurement category names
        </h2>
        <p id={`${fieldId}-guidance`} className="mt-1 text-sm text-muted-foreground">
          Keep &quot;{ORIGINAL_NAME}&quot; as an alias if historical data still uses it. It is
          optional; include the category names used by this community's uploads.
        </p>
      </div>
      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading procurement settings...
        </p>
      )}
      {loadError && (
        <div role="alert" className="text-sm text-destructive">
          Procurement settings could not be loaded. Your draft has been kept.
          <Button type="button" variant="link" disabled={saving} onClick={() => void refetch()}>
            Retry loading
          </Button>
        </div>
      )}
      <div className="max-w-2xl space-y-2">
        <Label htmlFor={fieldId}>Category names (one per line)</Label>
        <Textarea
          id={fieldId}
          value={text}
          rows={5}
          disabled={saving || isLoading}
          onChange={(event) => updateDraft(event.target.value)}
          aria-describedby={`${fieldId}-guidance${validationError ? ` ${fieldId}-validation` : ""}`}
          aria-invalid={Boolean(validationError)}
        />
        {validationError && (
          <p id={`${fieldId}-validation`} role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        )}
      </div>
      {availableNames.length > 0 && (
        <div className="max-w-2xl space-y-2">
          <Label htmlFor={`${fieldId}-uploaded`}>Uploaded category</Label>
          <div className="flex flex-wrap gap-2">
            <select
              id={`${fieldId}-uploaded`}
              className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-80"
              value={selectedName}
              disabled={saving || isLoading}
              onChange={(event) => setSelectedName(event.target.value)}
            >
              <option value="">Select a category</option>
              {availableNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || isLoading || !availableNames.includes(selectedName)}
              onClick={() => {
                updateDraft(`${text.trimEnd()}${text.trim() ? "\n" : ""}${selectedName}`);
                setSelectedName("");
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add category
            </Button>
          </div>
        </div>
      )}
      <Button
        type="button"
        size="sm"
        onClick={() => void save()}
        disabled={
          draft === null || saving || isLoading || Boolean(loadError) || Boolean(validationError)
        }
      >
        <Save className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save procurement names"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </section>
  );
}
