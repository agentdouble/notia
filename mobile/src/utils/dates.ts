export function formatSidebarTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function formatHeaderTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
