"use client";

import { useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
    });
    setBusy(false);
    if (res.ok) window.location.href = "/dashboard";
    else setError(res.status === 429 ? "Too many attempts. Please wait and try again." : "Invalid email or password.");
  }

  return (
    <main className="narrow card">
      <h1>SAHARA sign in</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="muted">New to SAHARA? <Link href="/register">Create a family account</Link></p>
    </main>
  );
}
