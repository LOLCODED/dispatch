export const ticketTextLimit = 12000;
export const longPasteLength = 1000;
export const composerText = (visible, attachments) => [visible, ...attachments].filter(Boolean).join('\n\n');

export function attachPastedText(visible, attachments, text, start, end) {
  const nextVisible = visible.slice(0, start) + visible.slice(end);
  const nextAttachments = [...attachments, text];
  return composerText(nextVisible, nextAttachments).length <= ticketTextLimit ? { visible: nextVisible, attachments: nextAttachments } : null;
}
