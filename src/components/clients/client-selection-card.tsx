import type { ReactNode } from "react";

export type ClientSelectionOption = {
  value: string;
  label: string;
};

export function ClientSelectionCard({
  id,
  label,
  options,
  placeholder = "請選擇個案",
  placeholderDisabled = false,
  value,
  defaultValue,
  disabled = false,
  onValueChange,
  actionLabel,
  supplement,
}: {
  id: string;
  label: string;
  options: ClientSelectionOption[];
  placeholder?: string;
  placeholderDisabled?: boolean;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  actionLabel?: string;
  supplement?: ReactNode;
}) {
  return (
    <section aria-label={`${label}選擇`} className="client-selection-card" data-client-selection>
      <div className="client-selection-card__heading">
        <label className="client-selection-card__label" htmlFor={id}>{label}</label>
        {supplement ? <div className="client-selection-card__supplement">{supplement}</div> : null}
      </div>
      <div className="client-selection-card__controls">
        {/* Native popup geometry is intentionally platform-owned; only the closed field frame is shared. */}
        <select
          className="client-selection-card__select"
          id={id}
          {...(value === undefined ? { defaultValue } : { value })}
          disabled={disabled}
          name="client"
          required
          onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
        >
          <option disabled={placeholderDisabled} value="">{placeholder}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {actionLabel ? <button className="button button--secondary client-selection-card__action" type="submit">{actionLabel}</button> : null}
      </div>
    </section>
  );
}
