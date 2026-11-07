import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Film,
  Loader2,
  Network,
  Share2,
  Tv,
  Users,
  X,
} from 'lucide-react';
import type { CatalogMediaWork } from '../services/catalogStorage';
import {
  fetchCastConnections,
  sharedProductionToSearchResult,
  type CastConnectionsGraph,
  type SharedProduction,
} from '../services/castConnectionsService';
import type {
  EvaluatedActor,
  MediaWork,
  SearchResultItem,
} from '../types/media';

interface CastConnectionsSectionProps {
  work: MediaWork;
  actors: EvaluatedActor[];
  catalogWorks: CatalogMediaWork[];
  tmdbKey: string;
  onSelectSharedWork: (item: SearchResultItem) => void;
}

interface PositionedNode {
  actor: EvaluatedActor;
  x: number;
  y: number;
  degree: number;
  totalCollaborations: number;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function computeLineThickness(sharedCount: number): number {
  if (sharedCount <= 1) return 2.2;
  return Math.min(2.2 + (sharedCount - 1) * 1.65, 10.5);
}

/**
 * Computes a clean, deterministic 2D network layout for all cast members of the current work.
 * Connected cast members are arranged in an inner force-relaxed ring so connecting lines
 * are clear and non-overlapping, while unconnected cast members form an outer ring.
 */
function computeNetworkLayout(
  actors: EvaluatedActor[],
  graph: CastConnectionsGraph | null,
  width: number,
  height: number
): PositionedNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const count = actors.length;
  if (count === 0) return [];

  const connectionsMap = graph?.connectionsByActorId || {};
  const connectedActors: EvaluatedActor[] = [];
  const unconnectedActors: EvaluatedActor[] = [];

  for (const actor of actors) {
    const conns = connectionsMap[actor.id] || [];
    if (conns.length > 0) {
      connectedActors.push(actor);
    } else {
      unconnectedActors.push(actor);
    }
  }

  // Order connected actors by degree & shared neighbors to minimize long crossings
  connectedActors.sort((a, b) => {
    const degA = (connectionsMap[a.id] || []).length;
    const degB = (connectionsMap[b.id] || []).length;
    if (degB !== degA) return degB - degA;
    return a.billingOrder - b.billingOrder;
  });

  const positions = new Map<string, { x: number; y: number }>();

  if (connectedActors.length > 0 && unconnectedActors.length > 0) {
    // Dual-ring layout: connected actors in inner ring, unconnected in outer ring
    const innerRx = Math.min(width * 0.28, 255);
    const innerRy = Math.min(height * 0.28, 175);

    connectedActors.forEach((actor, idx) => {
      const angle =
        -Math.PI / 2 + (idx / connectedActors.length) * Math.PI * 2;
      // Slight radial alternation prevents any 3 nodes from being colinear across center
      const stagger = idx % 2 === 0 ? 1 : 0.88;
      positions.set(actor.id, {
        x: cx + Math.cos(angle) * innerRx * stagger,
        y: cy + Math.sin(angle) * innerRy * stagger,
      });
    });

    const outerRx = Math.min(width * 0.43, 395);
    const outerRy = Math.min(height * 0.42, 260);
    unconnectedActors.forEach((actor, idx) => {
      const angle =
        -Math.PI / 2 + (idx / unconnectedActors.length) * Math.PI * 2;
      positions.set(actor.id, {
        x: cx + Math.cos(angle) * outerRx,
        y: cy + Math.sin(angle) * outerRy,
      });
    });
  } else {
    // Single ring (or two concentric rings if cast > 28)
    const list =
      connectedActors.length > 0 ? connectedActors : unconnectedActors;
    if (list.length <= 26) {
      const rx = Math.min(width * 0.37, 345);
      const ry = Math.min(height * 0.37, 230);
      list.forEach((actor, idx) => {
        const angle = -Math.PI / 2 + (idx / list.length) * Math.PI * 2;
        const stagger = idx % 2 === 0 ? 1 : 0.9;
        positions.set(actor.id, {
          x: cx + Math.cos(angle) * rx * stagger,
          y: cy + Math.sin(angle) * ry * stagger,
        });
      });
    } else {
      const innerCount = Math.ceil(list.length * 0.42);
      const innerList = list.slice(0, innerCount);
      const outerList = list.slice(innerCount);
      const innerRx = Math.min(width * 0.25, 230);
      const innerRy = Math.min(height * 0.25, 155);
      const outerRx = Math.min(width * 0.42, 390);
      const outerRy = Math.min(height * 0.41, 255);

      innerList.forEach((actor, idx) => {
        const angle = -Math.PI / 2 + (idx / innerList.length) * Math.PI * 2;
        positions.set(actor.id, {
          x: cx + Math.cos(angle) * innerRx,
          y: cy + Math.sin(angle) * innerRy,
        });
      });
      outerList.forEach((actor, idx) => {
        const angle = -Math.PI / 2 + (idx / outerList.length) * Math.PI * 2;
        positions.set(actor.id, {
          x: cx + Math.cos(angle) * outerRx,
          y: cy + Math.sin(angle) * outerRy,
        });
      });
    }
  }

  return actors.map((actor) => {
    const pos = positions.get(actor.id) || { x: cx, y: cy };
    const conns = connectionsMap[actor.id] || [];
    const totalCollaborations = conns.reduce(
      (acc, c) => acc + c.sharedWorks.length,
      0
    );
    return {
      actor,
      x: pos.x,
      y: pos.y,
      degree: conns.length,
      totalCollaborations,
    };
  });
}

export function CastConnectionsSection({
  work,
  actors,
  catalogWorks,
  tmdbKey,
  onSelectSharedWork,
}: CastConnectionsSectionProps) {
  const [graph, setGraph] = useState<CastConnectionsGraph | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [isNetworkModalOpen, setIsNetworkModalOpen] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [hoveredActorId, setHoveredActorId] = useState<string | null>(null);

  // Fetch cast connections whenever the active work or cast changes
  useEffect(() => {
    let cancelled = false;
    setIsLoadingGraph(true);

    fetchCastConnections(work, actors, catalogWorks, tmdbKey)
      .then((result) => {
        if (!cancelled) {
          setGraph(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGraph({
            workId: work.id,
            edges: [],
            connectionsByActorId: {},
            totalConnectedActors: 0,
            totalUniqueSharedWorks: 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingGraph(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [work, actors, catalogWorks, tmdbKey]);

  // Close dialogs on Escape key (closing the top-most dialog first)
  useEffect(() => {
    if (!isNetworkModalOpen && !selectedActorId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedActorId) {
          setSelectedActorId(null);
        } else {
          setIsNetworkModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNetworkModalOpen, selectedActorId]);

  const svgWidth = 940;
  const svgHeight = 600;

  const positionedNodes = useMemo(
    () => computeNetworkLayout(actors, graph, svgWidth, svgHeight),
    [actors, graph]
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of positionedNodes) {
      map.set(n.actor.id, n);
    }
    return map;
  }, [positionedNodes]);

  const selectedActor = useMemo(
    () => actors.find((a) => a.id === selectedActorId) || null,
    [actors, selectedActorId]
  );

  const selectedActorConnections = useMemo(() => {
    if (!selectedActor || !graph) return [];
    return graph.connectionsByActorId[selectedActor.id] || [];
  }, [selectedActor, graph]);

  const handleClickSharedProduction = (prod: SharedProduction) => {
    const searchItem = sharedProductionToSearchResult(prod);
    setSelectedActorId(null);
    setIsNetworkModalOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onSelectSharedWork(searchItem);
  };

  const edgeCount = graph?.edges.length ?? 0;
  const connectedActorCount = graph?.totalConnectedActors ?? 0;
  const sharedWorksCount = graph?.totalUniqueSharedWorks ?? 0;

  return (
    <>
      <section
        className="cast-connections-section"
        aria-labelledby="cast-connections-heading"
      >
        <div className="cast-connections-content">
          <div className="cast-connections-info">
            <div className="cast-connections-title-row">
              <span className="cast-connections-icon-badge" aria-hidden="true">
                <Share2 size={16} />
              </span>
              <h2
                id="cast-connections-heading"
                className="cast-connections-heading"
              >
                Cast Connections
              </h2>
              {isLoadingGraph ? (
                <span className="cast-connections-pill loading">
                  <Loader2 size={12} className="spin-icon" />
                  <span>Mapping co-star network...</span>
                </span>
              ) : (
                <span className="cast-connections-pill">
                  {edgeCount}{' '}
                  {edgeCount === 1 ? 'co-star link' : 'co-star links'} ·{' '}
                  {sharedWorksCount} shared{' '}
                  {sharedWorksCount === 1 ? 'production' : 'productions'}
                </span>
              )}
            </div>

            <p className="cast-connections-description">
              Explore how the cast members of <strong>{work.title}</strong> are
              connected through other movies and TV shows they appeared in
              together.
            </p>
          </div>

          <div className="cast-connections-actions">
            <button
              type="button"
              id="open-cast-connections-btn"
              className="cast-connections-open-btn"
              onClick={() => setIsNetworkModalOpen(true)}
            >
              <Network size={16} />
              <span>View Cast Connections</span>
            </button>
          </div>
        </div>
      </section>

      {/* Dialog 1: Cast Connections Network Dialog */}
      {isNetworkModalOpen && (
        <div
          className="modal-backdrop cast-network-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cast-network-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsNetworkModalOpen(false);
            }
          }}
        >
          <div className="modal-card cast-network-modal-card">
            <div className="modal-header">
              <div>
                <h2
                  id="cast-network-modal-title"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '1.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Network size={18} style={{ color: 'var(--alive-primary)' }} />
                  Cast Connections — {work.title}
                </h2>
                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.2rem',
                  }}
                >
                  All {actors.length} cast members are shown as nodes. Lines
                  connect actors who appeared together in another production
                  (line thickness = number of shared movies or shows).{' '}
                  <strong>Click any actor node</strong> to view their connected
                  co-stars and shared titles.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsNetworkModalOpen(false)}
                aria-label="Close Cast Connections Network"
              >
                <X size={16} />
              </button>
            </div>

            <div className="cast-network-toolbar">
              <div className="cast-network-stats">
                <span>
                  <strong>{actors.length}</strong> Cast Nodes
                </span>
                <span>·</span>
                <span>
                  <strong>{connectedActorCount}</strong> Connected Co-Stars
                </span>
                <span>·</span>
                <span>
                  <strong>{edgeCount}</strong> Connection{' '}
                  {edgeCount === 1 ? 'Line' : 'Lines'}
                </span>
                <span>·</span>
                <span>
                  <strong>{sharedWorksCount}</strong> Other Movies / Shows
                </span>
              </div>

              <div className="cast-network-legend">
                <span className="legend-item">
                  <span className="legend-dot alive" /> Living
                </span>
                <span className="legend-item">
                  <span className="legend-dot deceased" /> Deceased
                </span>
                <span className="legend-item">
                  <span className="legend-line-sample thin" /> 1 Shared Title
                </span>
                <span className="legend-item">
                  <span className="legend-line-sample thick" /> Multiple Shared
                  Titles
                </span>
              </div>
            </div>

            <div className="cast-network-canvas-wrap">
              {isLoadingGraph && (
                <div className="cast-network-loading-overlay">
                  <div className="spinner" />
                  <span>
                    Querying co-appearances across movies and TV shows...
                  </span>
                </div>
              )}

              <svg
                className="cast-network-svg"
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`Cast connections network graph for ${work.title}`}
              >
                {/* Single line per connected actor pair, thickness scaled by number of shared productions */}
                <g className="network-edges-layer">
                  {(graph?.edges || []).map((edge) => {
                    const n1 = nodeById.get(edge.actor1Id);
                    const n2 = nodeById.get(edge.actor2Id);
                    if (!n1 || !n2) return null;

                    const sharedCount = edge.sharedWorks.length;
                    const strokeWidth = computeLineThickness(sharedCount);
                    const isHighlighted =
                      hoveredActorId === edge.actor1Id ||
                      hoveredActorId === edge.actor2Id ||
                      selectedActorId === edge.actor1Id ||
                      selectedActorId === edge.actor2Id;
                    const isDimmed =
                      hoveredActorId !== null && !isHighlighted;

                    const midX = (n1.x + n2.x) / 2;
                    const midY = (n1.y + n2.y) / 2;

                    return (
                      <g key={edge.pairKey}>
                        <line
                          x1={n1.x}
                          y1={n1.y}
                          x2={n2.x}
                          y2={n2.y}
                          stroke={
                            isHighlighted
                              ? '#38bdf8'
                              : sharedCount >= 3
                              ? 'rgba(56, 189, 248, 0.72)'
                              : 'rgba(148, 163, 184, 0.48)'
                          }
                          strokeWidth={strokeWidth}
                          strokeLinecap="round"
                          opacity={isDimmed ? 0.16 : 1}
                        >
                          <title>
                            {n1.actor.name} &amp; {n2.actor.name}: {sharedCount}{' '}
                            shared{' '}
                            {sharedCount === 1 ? 'production' : 'productions'} (
                            {edge.sharedWorks.map((w) => w.title).join(', ')})
                          </title>
                        </line>
                        {isHighlighted && (
                          <g transform={`translate(${midX}, ${midY})`}>
                            <rect
                              x={-11}
                              y={-9}
                              width={22}
                              height={18}
                              rx={5}
                              fill="#0b1120"
                              stroke="#38bdf8"
                              strokeWidth={1.2}
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="#e0f2fe"
                              fontSize="10"
                              fontFamily="var(--font-mono)"
                              fontWeight="600"
                            >
                              {sharedCount}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>

                {/* Actor Nodes Layer */}
                <g className="network-nodes-layer">
                  {positionedNodes.map((node) => {
                    const { actor, x, y, degree } = node;
                    const isHovered = hoveredActorId === actor.id;
                    const isNeighborOfHovered =
                      hoveredActorId !== null &&
                      (graph?.connectionsByActorId[hoveredActorId] || []).some(
                        (c) => c.otherActor.id === actor.id
                      );
                    const isDimmed =
                      hoveredActorId !== null &&
                      !isHovered &&
                      !isNeighborOfHovered;

                    const baseRadius =
                      actors.length > 35
                        ? degree > 0
                          ? 15
                          : 12
                        : degree > 0
                        ? 19
                        : 15;
                    const radius = isHovered ? baseRadius + 3 : baseRadius;

                    const fillColor =
                      actor.status === 'alive'
                        ? '#064e3b'
                        : actor.status === 'deceased'
                        ? '#451a03'
                        : '#1f2937';
                    const strokeColor =
                      actor.status === 'alive'
                        ? '#10b981'
                        : actor.status === 'deceased'
                        ? '#f59e0b'
                        : '#9ca3af';

                    return (
                      <g
                        key={actor.id}
                        className="network-node-group"
                        transform={`translate(${x}, ${y})`}
                        style={{
                          cursor: 'pointer',
                          opacity: isDimmed ? 0.32 : 1,
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${actor.name} (${degree} connected co-stars)`}
                        onClick={() => setSelectedActorId(actor.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedActorId(actor.id);
                          }
                        }}
                        onMouseEnter={() => setHoveredActorId(actor.id)}
                        onMouseLeave={() =>
                          setHoveredActorId((prev) =>
                            prev === actor.id ? null : prev
                          )
                        }
                      >
                        <title>
                          {actor.name}
                          {actor.character ? ` (${actor.character})` : ''} —{' '}
                          {degree} connected{' '}
                          {degree === 1 ? 'co-star' : 'co-stars'}. Click to
                          inspect shared movies &amp; shows.
                        </title>

                        {degree > 0 && (
                          <circle
                            r={radius + 4}
                            fill="none"
                            stroke={
                              isHovered ? '#38bdf8' : 'rgba(56, 189, 248, 0.28)'
                            }
                            strokeWidth={isHovered ? 2 : 1.2}
                          />
                        )}

                        <circle
                          r={radius}
                          fill={fillColor}
                          stroke={isHovered ? '#f8fafc' : strokeColor}
                          strokeWidth={degree > 0 ? 2.4 : 1.6}
                        />

                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#f8fafc"
                          fontSize={actors.length > 35 ? '9.5' : '11'}
                          fontWeight="600"
                          fontFamily="var(--font-sans)"
                          pointerEvents="none"
                        >
                          {getInitials(actor.name)}
                        </text>

                        {degree > 0 && (
                          <g
                            transform={`translate(${radius * 0.72}, ${
                              -radius * 0.72
                            })`}
                            pointerEvents="none"
                          >
                            <circle
                              r={8}
                              fill="#0284c7"
                              stroke="#090b10"
                              strokeWidth={1.5}
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="#ffffff"
                              fontSize="8.5"
                              fontFamily="var(--font-mono)"
                              fontWeight="600"
                            >
                              {degree}
                            </text>
                          </g>
                        )}

                        <text
                          y={radius + 13}
                          textAnchor="middle"
                          fill={degree > 0 ? '#f3f4f6' : '#9ca3af'}
                          fontSize={actors.length > 35 ? '9.5' : '11'}
                          fontWeight={degree > 0 ? '600' : '400'}
                          fontFamily="var(--font-sans)"
                          paintOrder="stroke"
                          stroke="#090b10"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        >
                          {actor.name}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Dialog 2: Selected Actor Connections Dialog */}
      {selectedActor && (
        <div
          className="modal-backdrop actor-connections-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="actor-connections-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedActorId(null);
            }
          }}
        >
          <div className="modal-card actor-connections-modal-card">
            <div className="modal-header">
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <h2
                    id="actor-connections-modal-title"
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontSize: '1.35rem',
                    }}
                  >
                    {selectedActor.name}
                  </h2>
                  <span
                    className={`actor-status-pill ${selectedActor.status}`}
                  >
                    {selectedActor.status === 'alive'
                      ? 'Living'
                      : selectedActor.status === 'deceased'
                      ? 'Deceased'
                      : 'Unknown'}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: '0.84rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.25rem',
                  }}
                >
                  {selectedActor.character
                    ? `Played ${selectedActor.character} in ${work.title} · `
                    : `Cast member in ${work.title} · `}
                  Connected to{' '}
                  <strong>
                    {selectedActorConnections.length}{' '}
                    {selectedActorConnections.length === 1
                      ? 'co-star'
                      : 'co-stars'}
                  </strong>{' '}
                  across other movies and TV shows
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedActorId(null)}
                aria-label="Close actor connections dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="actor-connections-list">
              {selectedActorConnections.length === 0 ? (
                <div className="actor-connections-empty">
                  <Users size={24} style={{ color: 'var(--text-muted)' }} />
                  <p>
                    No shared movies or TV shows outside of{' '}
                    <strong>{work.title}</strong> were found between{' '}
                    <strong>{selectedActor.name}</strong> and the other cast
                    members.
                  </p>
                </div>
              ) : (
                selectedActorConnections.map(({ otherActor, sharedWorks }) => (
                  <div
                    key={otherActor.id}
                    className="collaborator-card"
                  >
                    <div className="collaborator-header">
                      <div className="collaborator-identity">
                        <span
                          className={`legend-dot ${
                            otherActor.status === 'alive'
                              ? 'alive'
                              : 'deceased'
                          }`}
                        />
                        <div>
                          <div className="collaborator-name">
                            {otherActor.name}
                          </div>
                          {otherActor.character && (
                            <div className="collaborator-role">
                              as {otherActor.character} in {work.title}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="collaborator-count-badge">
                        {sharedWorks.length} shared{' '}
                        {sharedWorks.length === 1
                          ? 'production'
                          : 'productions'}
                      </span>
                    </div>

                    <ul className="shared-works-list">
                      {sharedWorks.map((prod) => (
                        <li key={`${prod.id}-${prod.title}`}>
                          <a
                            href={`#work-${encodeURIComponent(prod.title)}`}
                            className="shared-work-link"
                            onClick={(e) => {
                              e.preventDefault();
                              handleClickSharedProduction(prod);
                            }}
                          >
                            <span className="shared-work-link-main">
                              {prod.mediaType === 'tv' ||
                              prod.mediaType === 'miniseries' ? (
                                <Tv size={14} />
                              ) : (
                                <Film size={14} />
                              )}
                              <span className="shared-work-title">
                                {prod.title}
                              </span>
                              {prod.releaseYear && (
                                <span className="shared-work-year">
                                  ({prod.releaseYear})
                                </span>
                              )}
                            </span>
                            <span className="shared-work-link-cta">
                              <span>
                                {prod.mediaType === 'tv'
                                  ? 'TV Series'
                                  : prod.mediaType === 'miniseries'
                                  ? 'Miniseries'
                                  : 'Movie'}
                              </span>
                              <ArrowUpRight size={14} />
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
