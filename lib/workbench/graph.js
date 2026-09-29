const NS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

/** A bounded view of declared edges; the text view retains the full analysis. */
export function renderFlowGraph(container, analysis, currentState, status = 'idle') {
  const nodes = analysis.nodes.slice(0, 60);
  const visible = new Set(nodes.map(node => node.id));
  const edges = analysis.edges.filter(edge => visible.has(edge.from) &&
    (edge.terminal || visible.has(edge.to) || edge.missingTarget)).slice(0, 120);
  const levels = new Map();
  const queue = visible.has(analysis.initialState) ? [analysis.initialState] : [];
  if (queue.length) levels.set(queue[0], 0);
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(edge => { if (!edge.terminal && visible.has(edge.to)) adjacency.get(edge.from).push(edge.to); });
  for (let i = 0; i < queue.length; i++) {
    for (const target of adjacency.get(queue[i])) {
      if (!levels.has(target)) { levels.set(target, levels.get(queue[i]) + 1); queue.push(target); }
    }
  }
  const lastLevel = Math.max(0, ...levels.values()) + 1;
  nodes.forEach(node => { if (!levels.has(node.id)) levels.set(node.id, lastLevel); });
  const end = Symbol('END');
  const boxes = nodes.map(node => ({ ...node, key: node.id, level: levels.get(node.id) }));
  const missing = [...new Set(edges.filter(edge => edge.missingTarget).map(edge => edge.to))].slice(0, 30);
  const exitLevel = Math.max(0, ...boxes.map(box => box.level)) + 1;
  missing.forEach(id => boxes.push({ id, key: id, level: exitLevel, missing: true }));
  if (edges.some(edge => edge.terminal) || nodes.some(node => node.terminal)) boxes.push({ id: 'END', key: end, level: exitLevel, endpoint: true });
  const rows = new Map();
  const positions = new Map();
  for (const box of boxes) {
    const row = rows.get(box.level) || 0;
    rows.set(box.level, row + 1);
    positions.set(box.key, { x: 24 + box.level * 235, y: 34 + row * 120 });
  }
  const width = Math.max(360, ...[...positions.values()].map(p => p.x + 245));
  const height = Math.max(150, ...[...positions.values()].map(p => p.y + 105));
  const svg = svgElement('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Declared flow graph. ${analysis.summary.states} states. Current state: ${currentState || (status === 'expired' ? 'none (expired)' : 'not started')}. Use the text view for all transitions.` });
  const defs = svgElement('defs');
  const marker = svgElement('marker', { id: 'flow-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
  defs.append(marker); svg.append(defs);
  const grouped = new Map();
  const drawEdges = [...edges];
  nodes.filter(node => node.terminal && !edges.some(edge => edge.from === node.id && edge.terminal))
    .forEach(node => drawEdges.push({ from: node.id, terminal: true, kind: 'end' }));
  for (const edge of drawEdges) {
    const target = edge.terminal ? end : edge.to;
    if (!positions.has(target)) continue;
    const key = JSON.stringify([edge.from, edge.terminal ? null : target]);
    if (!grouped.has(key)) grouped.set(key, { from: edge.from, target, labels: [], missing: edge.missingTarget, conflict: edge.navigationConflict });
    const labels = grouped.get(key).labels;
    const label = `${edge.input ?? edge.kind ?? 'next'}${edge.navigationConflict ? ' (back conflict)' : ''}`;
    if (!labels.includes(label)) labels.push(label);
  }
  let lane = 0;
  let edgeBottom = height;
  for (const edge of grouped.values()) {
    const from = positions.get(edge.from), to = positions.get(edge.target);
    const x1 = from.x + 165, y1 = from.y + 30, x2 = to.x, y2 = to.y + 30;
    let d, labelX, labelY;
    if (edge.from === edge.target) {
      d = `M ${x1} ${y1} C ${x1 + 50} ${y1 - 65}, ${from.x + 60} ${from.y - 40}, ${from.x + 60} ${from.y}`;
      labelX = from.x + 110; labelY = from.y - 14;
    } else if (x2 > x1 && x2 - x1 < 100 && y1 === y2) {
      d = `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
      labelX = (x1 + x2) / 2; labelY = (y1 + y2) / 2 - 8;
    } else if (from.x === to.x) {
      const side = x1 + (y2 > y1 ? 25 : 45);
      d = `M ${x1} ${y1} H ${side} V ${y2} H ${to.x + 165}`;
      labelX = side; labelY = (y1 + y2) / 2 + (y2 > y1 ? -8 : 8);
    } else {
      // Route long/cross-row edges outside the node grid. A line passing
      // through intermediate boxes would falsely imply extra transitions.
      const bottom = height - 20 + lane++ * 24;
      d = `M ${x1} ${y1} H ${x1 + 18} V ${bottom} H ${x2 - 18} V ${y2} H ${x2}`;
      labelX = (x1 + x2) / 2; labelY = bottom - 5;
      edgeBottom = Math.max(edgeBottom, bottom + 18);
    }
    svg.append(svgElement('path', { d, class: edge.missing ? 'graph-edge missing' : edge.conflict ? 'graph-edge unknown' : 'graph-edge', 'marker-end': 'url(#flow-arrow)' }));
    const label = svgElement('text', { x: labelX, y: labelY, class: 'graph-edge-label', 'text-anchor': 'middle' },
      edge.labels.join(' / ').slice(0, 24));
    label.append(svgElement('title', {}, edge.labels.join(' / ')));
    svg.append(label);
  }
  svg.setAttribute('height', String(edgeBottom));
  svg.setAttribute('viewBox', `0 0 ${width} ${edgeBottom}`);
  for (const box of boxes) {
    const { x, y } = positions.get(box.key);
    const group = svgElement('g', { class: `graph-node${box.id === currentState && !box.missing && !box.endpoint ? ' current' : ''}${box.missing ? ' missing' : ''}${box.reachability === 'unreachable' ? ' unreachable' : ''}` });
    group.append(svgElement('rect', { x, y, width: 165, height: 60, rx: 7 }));
    group.append(svgElement('text', { x: x + 12, y: y + 25 }, box.id.length > 19 ? `${box.id.slice(0, 18)}…` : box.id));
    const detail = box.missing ? 'missing target' : box.endpoint ? 'session ends' :
      [box.isInitial ? 'start' : '', box.terminal ? 'terminal' : '',
        box.dynamic || box.terminal === null ? 'unknown exits' : '',
        box.reachability === 'unreachable' ? 'unreachable' : box.reachability === 'unknown' ? 'path unknown' : ''].filter(Boolean).join(' · ') || 'declared';
    group.append(svgElement('text', { x: x + 12, y: y + 44, class: 'graph-node-detail' }, detail));
    group.append(svgElement('title', {}, `${box.id}: ${detail}`));
    svg.append(group);
    if (box.dynamic || box.terminal === null) {
      svg.append(svgElement('path', { d: `M ${x + 165} ${y + 48} h 25`, class: 'graph-edge unknown' }));
      svg.append(svgElement('text', { x: x + 194, y: y + 52, class: 'graph-edge-label' }, '?'));
    }
  }
  container.replaceChildren(svg);
  if (container.dataset.state !== (currentState || '')) {
    const position = positions.get(currentState);
    container.scrollLeft = position ? Math.max(0, position.x - container.clientWidth / 2 + 82) : 0;
    container.scrollTop = position ? Math.max(0, position.y - container.clientHeight / 2 + 30) : 0;
    container.dataset.state = currentState || '';
  }
  const truncated = nodes.length < analysis.nodes.length || edges.length < analysis.edges.length ||
    missing.length < new Set(edges.filter(edge => edge.missingTarget).map(edge => edge.to)).size;
  return truncated;
}
