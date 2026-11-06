"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/* Copies a full address. The label changes for a moment so the click is visibly acknowledged. */
export function CopyAddress({ address, label }: { address: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const area = document.createElement("textarea");
      area.value = address;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" className="v4-copy" data-copied={copied} onClick={copy} aria-label={copied ? `Copied ${label}` : `Copy ${label} address`}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
