"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <Callout tone="danger" title="Something went wrong on this page">
        {error.message || "Unexpected error."} {error.digest ? `(ref ${error.digest})` : ""}
      </Callout>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
