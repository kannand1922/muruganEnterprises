import { IonButton, IonPopover } from "@ionic/react";

export type MultiSelectFilterOption = {
  value: string;
  label: string;
};

type MultiSelectFilterPopoverProps = {
  isOpen: boolean;
  event?: Event;
  onDidDismiss: () => void;
  draftValues: string[];
  onDraftValuesChange: (values: string[]) => void;
  onApply: () => void;
  options: MultiSelectFilterOption[];
  allLabel: string;
  className?: string;
};

export const ALL_MULTI_FILTER_VALUE = "__all__";

export function MultiSelectFilterPopover({
  isOpen,
  event,
  onDidDismiss,
  draftValues,
  onDraftValuesChange,
  onApply,
  options,
  allLabel,
  className = "search-filter-popover",
}: MultiSelectFilterPopoverProps) {
  const normalizedDraftValueSet = new Set(
    draftValues.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
  );

  function toggleValue(value: string) {
    if (value === ALL_MULTI_FILTER_VALUE) {
      onDraftValuesChange([]);
      return;
    }

    const normalizedValue = String(value || "").trim().toLowerCase();
    if (!normalizedValue) return;

    const nextValues = draftValues.some(
      (entry) => String(entry || "").trim().toLowerCase() === normalizedValue
    )
      ? draftValues.filter(
          (entry) => String(entry || "").trim().toLowerCase() !== normalizedValue
        )
      : [...draftValues, value];

    onDraftValuesChange(nextValues);
  }

  return (
    <IonPopover
      isOpen={isOpen}
      event={event}
      onDidDismiss={onDidDismiss}
      className={className}
    >
      <div className="search-filter-popover-content">
        <div className="search-filter-popover-actions">
          <IonButton size="small" fill="clear" onClick={onDidDismiss}>
            Close
          </IonButton>
          <IonButton size="small" onClick={onApply}>
            Apply
          </IonButton>
        </div>

        <button
          type="button"
          className="search-filter-popover-row"
          onClick={() => toggleValue(ALL_MULTI_FILTER_VALUE)}
        >
          <input type="checkbox" readOnly checked={draftValues.length === 0} />
          <span>{allLabel}</span>
        </button>

        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className="search-filter-popover-row"
            onClick={() => toggleValue(option.value)}
          >
            <input
              type="checkbox"
              readOnly
              checked={normalizedDraftValueSet.has(option.value.trim().toLowerCase())}
            />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </IonPopover>
  );
}
