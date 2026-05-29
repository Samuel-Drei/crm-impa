type FlowContextMenuPositionInput = {
  clientX: number
  clientY: number
  viewportWidth: number
  viewportHeight: number
  menuWidth?: number
  menuHeight?: number
  margin?: number
}

const defaultMenuWidth = 180
const defaultMenuHeight = 130
const defaultMargin = 8

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

export const getFlowContextMenuPosition = ({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  menuWidth = defaultMenuWidth,
  menuHeight = defaultMenuHeight,
  margin = defaultMargin,
}: FlowContextMenuPositionInput) => ({
  x: clamp(clientX, margin, viewportWidth - menuWidth - margin),
  y: clamp(clientY, margin, viewportHeight - menuHeight - margin),
})
