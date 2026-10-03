"use client";

import type { ReactNode, Ref } from "react";

/**
 * The paste step of a sign-in started on the server: what to do, an optional
 * line with a link to the sign-in page for when no browser window opened, and
 * one box for the redirected address or code. The box is always shown, since
 * a remote or phone browser cannot reach the server's own callback listener.
 * Enter or the button submits a non-empty value.
 */
export function OAuthPastePanel({
  message,
  hint,
  value,
  placeholder,
  submitLabel,
  inputRef,
  onValueChange,
  onSubmit,
}: {
  message: ReactNode;
  hint?: ReactNode;
  value: string;
  placeholder: string;
  submitLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = value.trim().length > 0;
  return (
    <div className="oauth-paste-panel">
      <p className="oauth-paste-message">{message}</p>
      {hint && <p className="oauth-paste-hint">{hint}</p>}
      <div className="oauth-paste-row">
        <input
          ref={inputRef}
          value={value}
          className="oauth-paste-input"
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSubmit) onSubmit();
          }}
        />
        <button type="button" className="oauth-paste-submit" onClick={onSubmit} disabled={!canSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
