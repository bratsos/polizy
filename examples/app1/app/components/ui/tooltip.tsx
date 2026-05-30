import { Tooltip } from "@base-ui-components/react/tooltip";
import type * as React from "react";

/** App-wide provider — give one delay so grouped tooltips feel instant. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <Tooltip.Provider delay={250}>{children}</Tooltip.Provider>;
}

/**
 * A styled Base UI tooltip. `children` becomes the trigger (a single element),
 * `label` is the floating content — an accessible replacement for `title=`.
 */
export function InfoTip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="max-w-xs rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs leading-snug text-zinc-50 shadow-lg outline outline-1 outline-white/10 transition-[transform,opacity] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <Tooltip.Arrow className="data-[side=bottom]:top-[-6px] data-[side=top]:bottom-[-6px]">
              <svg width="12" height="6" viewBox="0 0 12 6" aria-hidden>
                <path d="M0 6 L6 0 L12 6 Z" className="fill-zinc-900" />
              </svg>
            </Tooltip.Arrow>
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
