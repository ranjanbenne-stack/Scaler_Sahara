"use client";

import { useState } from "react";
import Link from "next/link";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd.entries())),
    });
    setBusy(false);
    if (res.ok) {
      window.location.href = "/dashboard/household";
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(
      body.error === "email_taken"
        ? "An account with this email already exists."
        : res.status === 429
          ? "Too many attempts. Please wait and try again."
          : "Please check the form. Passwords need at least 10 characters.",
    );
  }

  return (
    <main className="narrow card">
      <h1>Create a SAHARA family account</h1>
      <p className="muted">For the adult child who will monitor requests and receive alerts.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>Your name<input name="displayName" required maxLength={80} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password (min 10 characters)<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label>Household name<input name="householdName" placeholder="e.g. Mum's home" required maxLength={100} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="muted">Already registered? <Link href="/login">Sign in</Link></p>
    </main>
  );
}
