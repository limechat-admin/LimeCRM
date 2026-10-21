"use client";
/** The design system's date input in place of the browser's native picker. Shows "22 Oct 2026"
 *  (day first, as we write dates in India) and submits the usual YYYY-MM-DD through a hidden
 *  input named `name`, so server actions read it like any other form field. */
import { DateInput, type DateInputProps } from "@mantine/dates";
import { Calendar } from "lucide-react";

export const DATE_FORMAT = "DD MMM YYYY";

type Props = Omit<DateInputProps, "defaultValue" | "value" | "onChange"> & {
  defaultValue?: string | null;
  value?: string | null;
  onChange?: (value: string | null) => void;
};

export function DateField({ defaultValue, value, onChange, size, ...props }: Props) {
  return (
    <DateInput
      valueFormat={DATE_FORMAT}
      placeholder="Pick a date"
      clearable={!props.required}
      firstDayOfWeek={1}
      // Red is for errors in the design system, so weekends aren't coloured.
      weekendDays={[]}
      highlightToday
      leftSection={<Calendar size={size === "xs" ? 14 : 16} strokeWidth={1.75} />}
      size={size}
      {...(value !== undefined ? { value: value || null } : { defaultValue: defaultValue || undefined })}
      onChange={onChange}
      {...props}
    />
  );
}
