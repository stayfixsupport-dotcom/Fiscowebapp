export type NotificationEvent = {
  id: string;
  source: "message" | "ai" | "document" | "relationship" | "appointment" | "service";
  actor: string;
  photo?: string;
  title: string;
  preview: string;
  at: number;
  isUnread: boolean;
  to: string;
};

export function notificationIsUnread(item: NotificationEvent, readIds: string[]) {
  return item.isUnread && !readIds.includes(item.id);
}

export function notificationTime(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(at).toLocaleDateString();
}

export function notificationInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
