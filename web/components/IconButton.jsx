import { Tooltip as Primitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/workspace';

export function Tooltip({ label, children }) {
  return <Primitive.Provider delayDuration={200}><Primitive.Root><Primitive.Trigger asChild>{children}</Primitive.Trigger><Primitive.Portal><Primitive.Content className="action-tooltip" sideOffset={7}>{label}<Primitive.Arrow/></Primitive.Content></Primitive.Portal></Primitive.Root></Primitive.Provider>;
}
export function IconButton({ label, shortcut, icon: Icon, href, download, variant = 'ghost', ...props }) {
  const icon = <Icon aria-hidden="true"/>;
  const content = download ? <a href={href} download>{icon}</a> : href ? <Link href={href}>{icon}</Link> : icon;
  return <Tooltip label={shortcut ? `${label} · ${shortcut}` : label}><Button variant={variant} size="icon" aria-label={label} aria-keyshortcuts={shortcut} {...props} asChild={Boolean(href)}>{content}</Button></Tooltip>;
}
