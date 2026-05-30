import { Select } from "@base-ui-components/react/select";
import * as React from "react";

type Item = { value: string; label: string };

/**
 * A styled Base UI Select that submits inside a React Router `<Form>`. Base UI's
 * Select is a custom component, so we mirror its value into a hidden input under
 * the given `name` — that's what the form actually serializes.
 */
export function FormSelect({
  name,
  defaultValue,
  items,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  items: Item[];
  ariaLabel?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select.Root
        items={items}
        value={value}
        onValueChange={(v) => setValue(v as string)}
      >
        <Select.Trigger
          aria-label={ariaLabel}
          className="inline-flex min-w-[10rem] items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 data-[popup-open]:bg-zinc-50"
        >
          <Select.Value />
          <Select.Icon className="text-zinc-400">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="z-30 outline-none" sideOffset={4}>
            <Select.Popup className="max-h-[18rem] min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg outline-none">
              {items.map((it) => (
                <Select.Item
                  key={it.value}
                  value={it.value}
                  className="flex cursor-default items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700"
                >
                  <Select.ItemIndicator className="text-indigo-600">
                    ✓
                  </Select.ItemIndicator>
                  <Select.ItemText>{it.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </>
  );
}
