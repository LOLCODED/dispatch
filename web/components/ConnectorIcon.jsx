// A connector may declare its own mark as SVG path data on a 24 × 24 view box; it is filled with currentColor.
export function connectorIcon(path, fallback) {
  if (!path) return fallback;
  return function ConnectorIcon(props) { return <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d={path}/></svg>; };
}
