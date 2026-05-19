import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force';
import { Modal, Button } from './common.js';
import type { CourseConcept, CoursePrereqEdge, CourseSlide } from '../types.js';

/**
 * Force-directed concept network for the parsed Foxxi course.
 *
 * Mirrors the original imported/foxxi_dashboard_v03.jsx graph:
 *   - Nodes sized by total frequency (4 + min(8, freq))
 *   - State styling: default / hovered / selected / in-slide / dimmed
 *   - Bare-topic concepts get a dashed outer ring when selected
 *   - Prereq edges = solid navy lines, modifier edges = dotted orange
 *   - Labels render conditionally (hovered / in-slide / top-6 prereq endpoints)
 *   - Hover via pointer events (touch-friendly on iOS Safari)
 *   - Legend modal (?) with inline SVG sample icons + ESC-to-close
 */
export function ConceptNetwork({
  concepts,
  prereqEdges,
  modifierPairs = [],
  slides,
  selectedSlideId,
  selectedConceptId,
  onSelectConcept,
  onJumpToSlide,
}: {
  concepts: CourseConcept[];
  prereqEdges: CoursePrereqEdge[];
  modifierPairs?: Array<{ modifier: string; target: string }>;
  slides: CourseSlide[];
  selectedSlideId: string | null;
  selectedConceptId: string | null;
  onSelectConcept: (cid: string | null) => void;
  onJumpToSlide?: (sid: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [tick, setTick] = useState(0);

  // Focus the top-N concepts by confidence × log(freq+1) — the original capped at ~20 hubs
  // but renders the full prereq neighbourhood around them. We render every concept that has
  // at least one edge or is taught on a slide.
  const visibleConcepts = useMemo(() => {
    const slideById = new Map(slides.map(s => [s.id, s]));
    return concepts.filter(c => {
      if ((c.taught_in_slides ?? []).length > 0) return true;
      return prereqEdges.some(e => e.from === c.id || e.to === c.id)
        || modifierPairs.some(m => m.modifier === c.id || m.target === c.id);
    });
  }, [concepts, prereqEdges, modifierPairs, slides]);

  const slideConceptIds = useMemo(() => {
    if (!selectedSlideId) return new Set<string>();
    const slide = slides.find(s => s.id === selectedSlideId);
    return new Set(slide?.concept_ids ?? []);
  }, [selectedSlideId, slides]);

  // d3-force simulation — run once, then update via React state on each tick.
  const simRef = useRef<Simulation<NodeDatum, EdgeDatum> | null>(null);
  const nodesRef = useRef<NodeDatum[]>([]);
  const linksRef = useRef<EdgeDatum[]>([]);

  useEffect(() => {
    const width = 720;
    const height = 480;

    const nodes: NodeDatum[] = visibleConcepts.map(c => ({
      id: c.id,
      label: c.label,
      tier: c.tier,
      confidence: c.confidence,
      freq: c.total_freq ?? 1,
      isBareTopic: c.tier === 1 && (c.taught_in_slides ?? []).length === 0,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const links: EdgeDatum[] = [
      ...prereqEdges
        .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
        .map(e => ({ source: e.from, target: e.to, kind: 'prereq' as const, confidence: e.confidence })),
      ...modifierPairs
        .filter(m => nodeIds.has(m.modifier) && nodeIds.has(m.target))
        .map(m => ({ source: m.modifier, target: m.target, kind: 'modifier' as const })),
    ];

    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation<NodeDatum>(nodes)
      .force('charge', forceManyBody().strength(-110))
      .force('link', forceLink<NodeDatum, EdgeDatum>(links).id((d: NodeDatum) => d.id).distance(60).strength(0.5))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<NodeDatum>().radius((d: NodeDatum) => nodeRadius(d) + 4))
      .alpha(1)
      .alphaDecay(0.025);

    sim.on('tick', () => setTick(t => t + 1));
    simRef.current = sim;

    return () => { sim.stop(); };
  }, [visibleConcepts, prereqEdges, modifierPairs]);

  function nodeRadius(n: NodeDatum) {
    return 4 + Math.min(8, Math.log2(n.freq + 1) * 3);
  }

  function nodeStateClass(n: NodeDatum): {
    fill: string; stroke: string; strokeWidth: number;
    dashed: boolean; opacity: number; ringed: boolean;
  } {
    const isSelected = selectedConceptId === n.id;
    const isHovered = hoveredId === n.id;
    const isInSlide = slideConceptIds.has(n.id);
    const hasFocus = selectedConceptId || hoveredId;
    const isNeighbour = hasFocus && linksRef.current.some(l => {
      const s = (l.source as NodeDatum).id ?? (l.source as unknown as string);
      const t = (l.target as NodeDatum).id ?? (l.target as unknown as string);
      const focus = selectedConceptId ?? hoveredId;
      return (s === focus && t === n.id) || (t === focus && s === n.id);
    });
    const dimmed = hasFocus && !isSelected && !isHovered && !isNeighbour && !isInSlide;

    return {
      fill: isSelected ? 'var(--text)' : 'var(--panel)',
      stroke: isSelected || isHovered ? 'var(--accent)' : 'var(--text)',
      strokeWidth: isSelected ? 1.8 : isHovered ? 2 : 1,
      dashed: isSelected && n.isBareTopic,
      opacity: dimmed ? 0.35 : 1,
      ringed: isInSlide,
    };
  }

  function showLabel(n: NodeDatum): boolean {
    if (hoveredId === n.id) return true;
    if (selectedConceptId === n.id) return true;
    if (slideConceptIds.has(n.id)) return true;
    // Top-6 by freq when nothing is focused — gives the graph some always-visible anchors.
    if (!hoveredId && !selectedConceptId) {
      const sorted = [...nodesRef.current].sort((a, b) => b.freq - a.freq);
      return sorted.slice(0, 6).some(top => top.id === n.id);
    }
    return false;
  }

  // Edge styling
  function edgeStyle(l: EdgeDatum) {
    const s = (l.source as NodeDatum).id;
    const t = (l.target as NodeDatum).id;
    const focus = selectedConceptId ?? hoveredId;
    const active = focus && (s === focus || t === focus);
    if (l.kind === 'modifier') {
      return { stroke: 'var(--accent)', dash: '3,2', opacity: active ? 0.95 : 0.45, width: 1 };
    }
    return {
      stroke: active ? 'var(--accent)' : 'var(--text)',
      dash: undefined as string | undefined,
      opacity: active ? 0.9 : focus ? 0.1 : 0.28,
      width: active ? 1.4 : 0.9,
    };
  }

  if (visibleConcepts.length === 0) {
    return null;
  }

  const width = 720;
  const height = 480;

  return (
    <>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: 6, padding: 12, marginBottom: 14,
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            fontFamily: "'EB Garamond', serif", fontStyle: 'italic',
            fontSize: 18, color: 'var(--text)',
          }}>Concept network</div>
          <div className="label" style={{ marginLeft: 'auto' }}>
            {visibleConcepts.length} nodes · {linksRef.current.filter(l => l.kind === 'prereq').length} prereq · {linksRef.current.filter(l => l.kind === 'modifier').length} modifier
          </div>
          <button onClick={() => setLegendOpen(true)} aria-label="Show legend"
            title="Show legend"
            style={{
              background: 'transparent', border: '1px solid var(--text)',
              borderRadius: '50%', width: 24, height: 24,
              cursor: 'pointer', color: 'var(--text)',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
            }}>?</button>
        </div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 480, background: 'var(--panel-2)', borderRadius: 4 }}
          onPointerLeave={() => setHoveredId(null)}
        >
          {/* Grid background */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--text)" strokeWidth="0.3" opacity="0.18" />
            </pattern>
            <marker id="arrow" viewBox="0 -5 10 10" refX="14" refY="0" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,-5L10,0L0,5" fill="var(--text)" />
            </marker>
            <marker id="arrow-active" viewBox="0 -5 10 10" refX="14" refY="0" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,-5L10,0L0,5" fill="var(--accent)" />
            </marker>
          </defs>
          <rect width={width} height={height} fill="url(#grid)" />

          {/* Edges — render BEHIND nodes */}
          <g key={`edges-${tick}`}>
            {linksRef.current.map((l, i) => {
              const s = l.source as NodeDatum;
              const t = l.target as NodeDatum;
              if (s?.x === undefined || t?.x === undefined) return null;
              const st = edgeStyle(l);
              return (
                <line
                  key={i}
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  stroke={st.stroke}
                  strokeWidth={st.width}
                  strokeDasharray={st.dash}
                  opacity={st.opacity}
                  markerEnd={l.kind === 'prereq' ? (st.opacity > 0.5 ? 'url(#arrow-active)' : 'url(#arrow)') : undefined}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g key={`nodes-${tick}`}>
            {nodesRef.current.map(n => {
              if (n.x === undefined || n.y === undefined) return null;
              const r = nodeRadius(n);
              const st = nodeStateClass(n);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  style={{ cursor: 'pointer', opacity: st.opacity }}
                  onPointerEnter={() => setHoveredId(n.id)}
                  onPointerUp={() => onSelectConcept(selectedConceptId === n.id ? null : n.id)}
                >
                  {st.ringed && (
                    <circle r={r + 3} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.7} />
                  )}
                  <circle
                    r={r}
                    fill={st.fill}
                    stroke={st.stroke}
                    strokeWidth={st.strokeWidth}
                    strokeDasharray={st.dashed ? '2,2' : undefined}
                  />
                  {showLabel(n) && (
                    <text
                      y={r + 11}
                      textAnchor="middle"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10.5,
                        fill: 'var(--text)',
                        paintOrder: 'stroke',
                        stroke: 'var(--panel-2)',
                        strokeWidth: 3,
                        strokeLinejoin: 'round',
                      }}
                    >{n.label}</text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {selectedConceptId && (
          <div style={{
            marginTop: 10, display: 'flex', gap: 8, alignItems: 'center',
            fontSize: 12,
          }}>
            <span className="label">selected:</span>
            <strong style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 16 }}>
              {visibleConcepts.find(c => c.id === selectedConceptId)?.label ?? selectedConceptId}
            </strong>
            {onJumpToSlide && (() => {
              const c = visibleConcepts.find(x => x.id === selectedConceptId);
              const taught = c?.taught_in_slides ?? [];
              if (taught.length === 0) return null;
              const first = slides.find(s => s.id === taught[0]);
              if (!first) return null;
              return (
                <Button small onClick={() => onJumpToSlide(first.id)}>
                  Jump to §{first.sequence_index + 1}
                </Button>
              );
            })()}
            <Button small onClick={() => onSelectConcept(null)}>Clear</Button>
          </div>
        )}
      </div>

      {legendOpen && (
        <Modal title="Concept-network legend" onClose={() => setLegendOpen(false)} width={560}>
          <LegendBody />
        </Modal>
      )}
    </>
  );
}

function LegendBody() {
  const items: { icon: React.ReactNode; label: string; desc: string }[] = [
    { icon: <circle r={6} fill="var(--panel)" stroke="var(--text)" strokeWidth={1} />, label: 'Default concept', desc: 'Concept extracted from the parsed course.' },
    { icon: <circle r={6} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} />, label: 'Hovered', desc: 'Pointer is over this node; label shown.' },
    { icon: <circle r={6} fill="var(--text)" stroke="var(--accent)" strokeWidth={1.8} />, label: 'Selected', desc: 'Click to pin focus; neighbours highlight.' },
    { icon: (
        <>
          <circle r={9} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.7} />
          <circle r={6} fill="var(--panel)" stroke="var(--text)" strokeWidth={1} />
        </>
      ), label: 'On current slide', desc: 'Concept is taught on the slide you have open.' },
    { icon: <circle r={6} fill="var(--text)" stroke="var(--accent)" strokeWidth={1.8} strokeDasharray="2,2" />, label: 'Bare topic (selected)', desc: 'A top-tier concept that is referenced but not directly taught.' },
    { icon: <line x1={-10} y1={0} x2={10} y2={0} stroke="var(--text)" strokeWidth={1} markerEnd="url(#legend-arrow)" />, label: 'Prereq edge', desc: 'Source concept depends on the target.' },
    { icon: <line x1={-10} y1={0} x2={10} y2={0} stroke="var(--accent)" strokeDasharray="3,2" strokeWidth={1} />, label: 'Modifier-of edge', desc: 'Source concept modifies the target (e.g. "course par" modifies "voltage").' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <svg width="0" height="0">
        <defs>
          <marker id="legend-arrow" viewBox="0 -5 10 10" refX="10" refY="0" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,-5L10,0L0,5" fill="var(--text)" />
          </marker>
        </defs>
      </svg>
      {items.map((it, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          padding: 8, border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--panel-2)',
        }}>
          <svg width={28} height={20} viewBox="-14 -10 28 20">{it.icon}</svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{it.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{it.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface NodeDatum extends SimulationNodeDatum {
  id: string;
  label: string;
  tier: number;
  confidence: number;
  freq: number;
  isBareTopic: boolean;
}

interface EdgeDatum extends SimulationLinkDatum<NodeDatum> {
  source: string | NodeDatum;
  target: string | NodeDatum;
  kind: 'prereq' | 'modifier';
  confidence?: number;
}
