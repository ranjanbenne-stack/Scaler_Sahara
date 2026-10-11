"use client";

import { useState, type FormEvent } from "react";
import { usePoll } from "@/components/usePoll";

interface Member {
  membershipId: string;
  userId: string;
  displayName: string;
  role: "PARENT" | "CHILD";
  isEmergencyContact: boolean;
  escalationOrder: number;
  telegramLinked: boolean;
  botStarted: boolean;
}
interface Me {
  user: { id: string; displayName: string; telegramLinked: boolean; botStarted: boolean };
  botUsername: string | null;
  households: { id: string; name: string; members: Member[] }[];
}

function LinkInstructions({ code, expiresAt, botUsername, who }: { code: string; expiresAt: string; botUsername: string | null; who: string }) {
  return (
    <div className="card">
      <div className="code">{code}</div>
      <p>On {who} phone, open the SAHARA bot{botUsername && <> (<a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">t.me/{botUsername}</a>)</>}, press <strong>Start</strong>, then send:</p>
      <div className="quote">/link {code}</div>
      <p className="muted">Nothing is emailed. The code is single use and expires {new Date(expiresAt).toLocaleTimeString()}. Generating a new code cancels this one.</p>
    </div>
  );
}

function PairingCodeBox({ householdId, role, botUsername, targetUserId, who, buttonLabel }: { householdId: string; role: "CHILD" | "PARENT"; botUsername: string | null; targetUserId?: string; who: string; buttonLabel?: string }) {
  const [parentName, setParentName] = useState("");
  const [result, setResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const res = await fetch(`/api/households/${householdId}/pairing-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(role === "PARENT" ? { role, parentDisplayName: parentName } : { role, ...(targetUserId ? { targetUserId } : {}) }),
    });
    if (!res.ok) {
      setError(res.status === 429 ? "Too many codes requested. Wait a few minutes." : "Could not create a code.");
      return;
    }
    setResult(await res.json());
  }

  return (
    <div className="stack">
      {role === "PARENT" && (
        <label>Parent's name (as you'd like it shown)
          <input value={parentName} onChange={(e) => setParentName(e.target.value)} maxLength={80} placeholder="e.g. Mum" />
        </label>
      )}
      <div><button onClick={generate} disabled={role === "PARENT" && !parentName.trim()}>{buttonLabel ?? (role === "PARENT" ? "Generate parent pairing code" : "Generate my pairing code")}</button></div>
      {error && <p className="error">{error}</p>}
      {result && <LinkInstructions code={result.code} expiresAt={result.expiresAt} botUsername={botUsername} who={who} />}
    </div>
  );
}

function AddMemberForm({ householdId, botUsername, onAdded }: { householdId: string; botUsername: string | null; onAdded: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [isEmergencyContact, setIsEmergencyContact] = useState(true);
  const [escalationOrder, setEscalationOrder] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    const res = await fetch(`/api/households/${householdId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, isEmergencyContact, escalationOrder }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 429 ? "Too many members added. Wait a while." : "Could not add this family member.");
      return;
    }
    const body = await res.json();
    setLink({ name: displayName.trim(), code: body.code, expiresAt: body.expiresAt });
    setDisplayName("");
    await onAdded();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <label>Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} placeholder="e.g. Priya" /></label>
        <label>Escalation level
          <select value={escalationOrder} onChange={(e) => setEscalationOrder(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Level {n}</option>)}
          </select>
        </label>
      </div>
      <label style={{ flexDirection: "row", alignItems: "center" }}>
        <input type="checkbox" checked={isEmergencyContact} onChange={(e) => setIsEmergencyContact(e.target.checked)} />
        Emergency contact (alerted on SOS)
      </label>
      <div><button type="submit" disabled={busy}>{busy ? "Adding…" : "Add family member"}</button></div>
      {error && <p className="error">{error}</p>}
      {link && <LinkInstructions code={link.code} expiresAt={link.expiresAt} botUsername={botUsername} who={`${link.name}'s`} />}
    </form>
  );
}

function AddHouseholdForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/households", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 429 ? "Too many households created. Wait a while." : "Could not add a household.");
      return;
    }
    setName("");
    await onAdded();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>Household name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. Dad's home" /></label>
      <div><button type="submit" disabled={busy}>{busy ? "Adding…" : "Add household"}</button></div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export default function HouseholdPage() {
  const { data, error, reload } = usePoll<Me>("/api/me", 5000);
  if (!data) {
    return (
      <>
        <h1>Households & family</h1>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </>
    );
  }

  async function updateMember(householdId: string, m: Member, patch: Partial<Pick<Member, "isEmergencyContact" | "escalationOrder">>) {
    await fetch(`/api/households/${householdId}/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await reload();
  }

  async function removeMember(householdId: string, m: Member) {
    if (!window.confirm(`Remove ${m.displayName} from this household and from emergency escalation?`)) return;
    const res = await fetch(`/api/households/${householdId}/members/${m.membershipId}`, { method: "DELETE" });
    if (!res.ok) {
      window.alert("Could not remove this member.");
      return;
    }
    await reload();
  }

  return (
    <>
      <h1>Households & family</h1>
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0 }}>Add another household</h2>
        <p className="muted">Use this for a second home, for example another parent who lives separately. You will be a member of both, and each one has its own parent link.</p>
        <AddHouseholdForm onAdded={reload} />
      </section>
      {data.households.map((h) => {
        const parent = h.members.find((m) => m.role === "PARENT");
        return (
          <section key={h.id} className="stack" style={{ marginBottom: "2rem" }}>
            <h2>{h.name}</h2>

            <div className="grid-2">
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Step 1 — Link your Telegram (to receive alerts)</h3>
                {data.user.telegramLinked && data.user.botStarted ? (
                  <p><span className="badge ACKNOWLEDGED">Linked</span> You will receive notifications in Telegram.</p>
                ) : (
                  <PairingCodeBox householdId={h.id} role="CHILD" botUsername={data.botUsername} who="your" />
                )}
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Step 2 — Link your parent's Telegram</h3>
                {parent?.telegramLinked ? (
                  <p><span className="badge ACKNOWLEDGED">Linked</span> {parent.displayName} can now send requests and SOS to the bot.</p>
                ) : (
                  <PairingCodeBox householdId={h.id} role="PARENT" botUsername={data.botUsername} who="your parent's" />
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Add a family member</h3>
              <p className="muted">Add their name here, then link Telegram on their phone with the code. No email is sent.</p>
              <AddMemberForm householdId={h.id} botUsername={data.botUsername} onAdded={reload} />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Members & emergency escalation</h3>
              <p className="muted">Level-1 emergency contacts are alerted immediately on SOS. If nobody acknowledges within the configured interval, the next level is alerted, then everyone is re-alerted.</p>
              <table className="responsive">
                <thead><tr><th>Name</th><th>Role</th><th>Telegram</th><th>Emergency contact</th><th>Escalation level</th><th></th></tr></thead>
                <tbody>
                  {h.members.map((m) => (
                    <tr key={m.membershipId}>
                      <td data-label="Name">{m.displayName}{m.userId === data.user.id && " (you)"}</td>
                      <td data-label="Role">{m.role === "PARENT" ? "Parent" : "Child"}</td>
                      <td data-label="Telegram">
                        {m.telegramLinked ? (m.botStarted ? <span className="badge SENT">Linked</span> : <span className="badge NEEDS_REVIEW">Bot not started</span>) : <span className="badge">Not linked</span>}
                        {m.role === "CHILD" && !m.telegramLinked && (
                          <div style={{ marginTop: "0.4rem" }}>
                            <PairingCodeBox householdId={h.id} role="CHILD" targetUserId={m.userId} botUsername={data.botUsername} who={`${m.displayName}'s`} buttonLabel="Get Telegram code" />
                          </div>
                        )}
                      </td>
                      <td data-label="Emergency contact">
                        {m.role === "CHILD" ? (
                          <input type="checkbox" checked={m.isEmergencyContact} onChange={(e) => updateMember(h.id, m, { isEmergencyContact: e.target.checked })} aria-label={`Emergency contact: ${m.displayName}`} />
                        ) : "—"}
                      </td>
                      <td data-label="Escalation level">
                        {m.role === "CHILD" ? (
                          <select value={m.escalationOrder} onChange={(e) => updateMember(h.id, m, { escalationOrder: Number(e.target.value) })}>
                            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Level {n}</option>)}
                          </select>
                        ) : "—"}
                      </td>
                      <td data-label="Remove">
                        {m.userId === data.user.id ? (
                          <span className="muted">—</span>
                        ) : (
                          <button type="button" className="secondary" onClick={() => removeMember(h.id, m)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Make sure emergency alerts are noticeable</h2>
        <p><strong>Important:</strong> SAHARA sends SOS alerts as normal, non-silent Telegram messages. Telegram <em>cannot</em> override your phone's silent or Do-Not-Disturb mode — whether an alert makes a sound depends on your phone and Telegram settings.</p>
        <ol>
          <li>In Telegram, open the SAHARA bot chat → tap its name → make sure <strong>Notifications</strong> are <strong>on</strong> (not muted) and pick a distinctive sound.</li>
          <li>Telegram → Settings → Notifications and Sounds → enable <strong>Private Chats</strong> notifications, <strong>Message Preview</strong> and sound.</li>
          <li>Phone settings → Apps/Notifications → Telegram → allow notifications, sound and lock-screen display.</li>
          <li>If you use Do Not Disturb / Focus, add Telegram as an allowed app (Android: priority app; iPhone: allowed apps in Focus).</li>
          <li>Disable battery optimisation for Telegram on Android so alerts aren't delayed.</li>
        </ol>
      </section>
    </>
  );
}
