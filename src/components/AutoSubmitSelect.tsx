"use client";

import { useEffect, useState } from "react";

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

/**
 * Self-submitting <select>. Held as controlled state so the displayed
 * value updates instantly on change (and persists through the server-
 * action round-trip). When a fresh `defaultValue` arrives from the
 * server (after revalidation), state syncs to it.
 */
export default function AutoSubmitSelect({
  name,
  defaultValue,
  options,
  className,
}: Props) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  return (
    <select
      name={name}
      value={value}
      className={className ?? "input py-1 text-xs"}
      onChange={(e) => {
        setValue(e.target.value);
        e.currentTarget.form?.requestSubmit();
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
