import { useEffect, useRef } from 'react'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
// @ts-ignore — sem types oficiais
import coseBilkent from 'cytoscape-cose-bilkent'
import type { BrainGraphPayload } from '@/services/aiBrain.service'

let registered = false
function ensureRegistered() {
  if (registered) return
  try {
    cytoscape.use(coseBilkent)
    registered = true
  } catch {
    // já registrado
    registered = true
  }
}

interface Props {
  data: BrainGraphPayload
  height?: number | string
  onNodeClick?: (nodeId: string, raw: any) => void
  onNodeDoubleClick?: (nodeId: string, raw: any) => void
}

export function BrainGraph({ data, height = 480, onNodeClick, onNodeDoubleClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    ensureRegistered()
    if (!containerRef.current) return

    const elements: ElementDefinition[] = [
      ...data.nodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          color: n.color,
          size: n.size,
          type: n.type,
          subjectType: n.subjectType,
          subjectId: n.subjectId,
        },
      })),
      ...data.edges.map(e => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          weight: e.weight,
          label: e.label || e.type,
        },
      })),
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.85,
            'border-color': '#ffffff',
            'border-width': 1,
            'border-opacity': 0.4,
            label: 'data(label)',
            color: '#e5e7eb',
            'font-size': 10,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'text-outline-color': '#0f0f10',
            'text-outline-width': 2,
            width: 'data(size)',
            height: 'data(size)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(weight, 0, 1, 0.5, 2.5)',
            'line-color': '#4b5563',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#4b5563',
            opacity: 0.6,
            'font-size': 9,
            color: '#9ca3af',
          },
        },
        {
          selector: 'node.dim',
          style: { opacity: 0.15 },
        },
        {
          selector: 'edge.dim',
          style: { opacity: 0.05 },
        },
        {
          selector: 'node.focus',
          style: { 'border-width': 3, 'border-color': '#fbbf24', 'border-opacity': 1 },
        },
      ],
      layout: {
        name: 'cose-bilkent',
        // @ts-ignore
        animate: 'end',
        animationDuration: 600,
        idealEdgeLength: 80,
        nodeRepulsion: 8000,
        gravity: 0.25,
        randomize: true,
      },
    })

    cy.on('tap', 'node', evt => {
      const node = evt.target
      // foco 1-hop
      cy.elements().addClass('dim')
      const neighborhood = node.closedNeighborhood()
      neighborhood.removeClass('dim')
      node.addClass('focus')
      onNodeClick?.(node.id(), node.data())
    })

    cy.on('dblclick', 'node', evt => {
      const node = evt.target
      onNodeDoubleClick?.(node.id(), node.data())
    })

    cy.on('tap', evt => {
      if (evt.target === cy) {
        cy.elements().removeClass('dim').removeClass('focus')
      }
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [data, onNodeClick, onNodeDoubleClick])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height, background: '#0f0f10', borderRadius: 8 }}
    />
  )
}
