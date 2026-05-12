"use client";

import { useState } from "react";

export function StateFlag({ state }: { state: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!state || errored) return null;
  const code = state.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w80/us-${code}.png`}
      alt={`${state.toUpperCase()} flag`}
      loading="lazy"
      onError={() => setErrored(true)}
      className="w-[60px]"
      style={{
        border: `0.5px solid var(--border-strong)`,
      }}
    />
  );
}
