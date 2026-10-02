import { DropdownMenu as Primitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuSub = Primitive.Sub;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }) {
  return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn('menu-popup', className)} {...props}/></Primitive.Portal>;
}

export function DropdownMenuItem({ className, ...props }) {
  return <Primitive.Item className={cn('menu-item', className)} {...props}/>;
}

export function DropdownMenuSeparator() { return <Primitive.Separator className="menu-separator"/>; }

export function DropdownMenuSubTrigger({ className, children, ...props }) {
  return <Primitive.SubTrigger className={cn('menu-item', className)} {...props}>{children}<ChevronRight size={13} className="menu-chevron" aria-hidden="true"/></Primitive.SubTrigger>;
}

export function DropdownMenuSubContent({ className, ...props }) {
  return <Primitive.Portal><Primitive.SubContent sideOffset={4} className={cn('menu-popup', className)} {...props}/></Primitive.Portal>;
}
