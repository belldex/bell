"use client";

import { useState } from "react";

/* Removes only the keys BELL itself wrote (all start with "bell"), then says so. */
export function ClearLocal() {
  const [state, setState] = useState<"idle" | "done" | "blocked">("idle");
  const clear = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^bell[.-]/.test(k)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      setState("done");
    } catch {
      setState("blocked");
    }
  };
  return (
    <>
      <button type="button" className="legal__btn" onClick={clear}>Clear local preferences</button>
      {state === "done" && <p role="status" className="legal__status">Cleared. Your wallet choice will be asked again next time.</p>}
      {state === "blocked" && <p role="status" className="legal__status">This browser blocks local storage, so there is nothing to clear.</p>}
    </>
  );
}
