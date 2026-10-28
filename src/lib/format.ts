export { relativeTime, formatDate, formatDateTime } from "@/lib/utils";

export function truncateText(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
