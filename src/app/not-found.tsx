import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-sm font-medium text-primary">404</div>
      <h1 className="text-2xl font-semibold">Not found in this workspace</h1>
      <p className="max-w-md text-sm text-muted-foreground">Workspaces are private to the browser that created them, so links from another browser or person won&apos;t open here.</p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
