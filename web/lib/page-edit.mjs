export const elementType = 'application/x-dispatch-element', componentType = 'application/x-dispatch-component';

const contains = (box, point) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
const area = box => box.width * box.height;
const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const parentOf = element => element.selector.includes(' > ') ? element.selector.replace(/ > [^>]+$/, '') : '';
const sameRow = (a, b) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) / 2;

export const percentBox = (box, size) => ({ left: `${box.x / size.width * 100}%`, top: `${box.y / size.height * 100}%`, width: `${box.width / size.width * 100}%`, height: `${box.height / size.height * 100}%` });
export const imagePoint = (client, rect, natural) => ({ x: (client.x - rect.left) / rect.width * natural.width, y: (client.y - rect.top) / rect.height * natural.height });

// The innermost element under a point: the smallest box wins and a later (deeper) element breaks ties. A dragged element and whatever sits inside it never become targets.
export function elementAt(elements, point, dragged = null) {
  let best = null;
  for (const element of elements) {
    if (element === dragged || (dragged && within(element.box, dragged.box)) || !contains(element.box, point)) continue;
    if (!best || area(element.box) <= area(best.box)) best = element;
  }
  return best;
}

// Siblings laid out side by side split left/right; stacked ones split top/bottom.
export const axisOf = (target, elements) => elements.some(element => element !== target && parentOf(element) === parentOf(target) && sameRow(element.box, target.box)) ? 'horizontal' : 'vertical';

export function dropTarget(elements, point, dragged = null) {
  const element = elementAt(elements, point, dragged);
  if (!element) return null;
  const axis = axisOf(element, elements), { box } = element;
  const after = axis === 'horizontal' ? point.x > box.x + box.width / 2 : point.y > box.y + box.height / 2;
  return { element, position: after ? 'after' : 'before', axis };
}

export const sameTarget = (a, b) => a === b || Boolean(a && b && a.element === b.element && a.position === b.position);
export const describeElement = element => `<${element.tag}>${element.text ? ` “${element.text}”` : ''} (${element.selector})`;
export const pagePath = url => { try { const { pathname, search } = new URL(url); return `${pathname}${search}`; } catch { return ''; } };

export function editLine(edit) {
  const page = pagePath(edit.url), where = page ? ` on ${page}` : '';
  if (edit.kind === 'move') return `Move ${describeElement(edit.element)} to ${edit.position} ${describeElement(edit.target)}${where}.`;
  if (edit.kind === 'insert') return `Insert the ${edit.component.name} component (${edit.component.path}) ${edit.position} ${describeElement(edit.target)}${where}.`;
  return `Selected ${describeElement(edit.element)}${where}.`;
}
