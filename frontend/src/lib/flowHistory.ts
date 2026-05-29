export type FlowHistory<TSnapshot> = {
  past: TSnapshot[]
  present: TSnapshot
  future: TSnapshot[]
}

const defaultHistoryLimit = 100

export const cloneFlowHistoryValue = <TValue>(value: TValue): TValue => {
  if (value === undefined) return value

  return JSON.parse(JSON.stringify(value)) as TValue
}

export const areFlowHistoryValuesEqual = <TValue>(
  first: TValue,
  second: TValue,
): boolean => JSON.stringify(first) === JSON.stringify(second)

export const createFlowHistory = <TSnapshot>(
  present: TSnapshot,
): FlowHistory<TSnapshot> => ({
  past: [],
  present: cloneFlowHistoryValue(present),
  future: [],
})

export const canUndoFlowHistory = <TSnapshot>(
  history: FlowHistory<TSnapshot> | null | undefined,
): boolean => Boolean(history?.past.length)

export const canRedoFlowHistory = <TSnapshot>(
  history: FlowHistory<TSnapshot> | null | undefined,
): boolean => Boolean(history?.future.length)

export const pushFlowHistory = <TSnapshot>(
  history: FlowHistory<TSnapshot>,
  nextPresent: TSnapshot,
  historyLimit = defaultHistoryLimit,
): FlowHistory<TSnapshot> => {
  if (areFlowHistoryValuesEqual(history.present, nextPresent)) return history

  return {
    past: [...history.past, cloneFlowHistoryValue(history.present)].slice(
      -historyLimit,
    ),
    present: cloneFlowHistoryValue(nextPresent),
    future: [],
  }
}

export const undoFlowHistory = <TSnapshot>(
  history: FlowHistory<TSnapshot>,
): FlowHistory<TSnapshot> => {
  if (!canUndoFlowHistory(history)) return history

  const previous = history.past[history.past.length - 1]

  return {
    past: history.past.slice(0, -1),
    present: cloneFlowHistoryValue(previous),
    future: [cloneFlowHistoryValue(history.present), ...history.future],
  }
}

export const redoFlowHistory = <TSnapshot>(
  history: FlowHistory<TSnapshot>,
): FlowHistory<TSnapshot> => {
  if (!canRedoFlowHistory(history)) return history

  const next = history.future[0]

  return {
    past: [...history.past, cloneFlowHistoryValue(history.present)],
    present: cloneFlowHistoryValue(next),
    future: history.future.slice(1),
  }
}
