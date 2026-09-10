import { useState } from "react";
import QRCode from "react-qr-code";
import { cx } from "./cx.js";
import { Button } from "./Button.js";

export interface QRCodeCardProps {
  /** Full mobile session URL. Only this URL is encoded - no IDs, tokens beyond the one in the URL, or PII. */
  url: string;
  /** Shortened display text, e.g. "verify.app/xP2K8m". Falls back to `url`. */
  displayText?: string;
  className?: string;
}

export function QRCodeCard({ url, displayText, className }: QRCodeCardProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context); fail silently.
    }
  }

  return (
    <div className={cx("flex flex-col items-center gap-3", className)}>
      <div className="rounded-md border border-border bg-white p-3 shadow-subtle">
        <QRCode value={url} size={148} aria-label="QR code to open the verification link on your phone" />
      </div>
      <p className="text-sm text-text-muted">Scan with your phone</p>
      <div className="flex w-full items-center gap-2">
        <code className="flex-1 truncate rounded-md border border-border bg-canvas px-2 py-1.5 text-xs text-text">
          {displayText ?? url}
        </code>
        <Button size="sm" variant="secondary" onClick={handleCopy} aria-live="polite">
          {copied ? "Copied" : "Copy Link"}
        </Button>
      </div>
    </div>
  );
}
