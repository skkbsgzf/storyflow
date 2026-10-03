/**
 * The rows a group switch would change: those not already in the requested
 * state. Switching a group off also leaves out the rows `keepOn` names, which
 * the caller reports instead; a filtered plugin package, for one, loses its
 * resource filters when disabled, so that stays a decision for its own switch.
 */
export function itemsToSwitch<T>(
  items: readonly T[],
  enabled: boolean,
  isEnabled: (item: T) => boolean,
  keepOn?: (item: T) => boolean,
): T[] {
  return items.filter((item) => isEnabled(item) !== enabled && (enabled || !keepOn?.(item)));
}
