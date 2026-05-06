"use client";

interface Option {
  value: string;
  label: string;
}

interface Props {
  name: string;
  defaultValue: string;
  options: Option[];
  className?: string;
}

export default function AutoSubmitSelect({
  name,
  defaultValue,
  options,
  className,
}: Props) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={className ?? "input py-1 text-xs"}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
