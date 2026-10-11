"use client";

import { useState } from "react";
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

function PairingCodeBox({ householdId, role, botUsername }: { householdId: string; role: "CHILD" | "PARENT"; botUsername: string | null }) {
  const [parentName, setParentName] = useState("");
  const [result, setResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const res = await fetch(`/api/households/${householdId}/pairing-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(role === "PARENT" ? { role, parentDisplayName: parentName } : { role }),
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
      <div><button onClick={generate} disabled={role === "PARENT" && !parentName.trim()}>Generate {role === "PARENT" ? "parent" : "my"} pairing code</button></div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="card">
          <div className="code">{result.code}</div>
          <p>
            {role === "PARENT" ? "On your parent's phone, open" : "On your phone, open"} the SAHARA bot in Telegram
            {botUsername && <> (<a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">t.me/{botUsername}</a>)</>}, press <strong>Start</strong>, then send:
          </p>
          <div className="quote">/link {result.code}</div>
          <p className="muted">Single use. Expires {new Date(result.expiresAt).toLocaleTimeString()}. Generating a new code cancels this one.</p>
        </div>
      )}
    </div>
  );
}

export default function HouseholdPage() {
  const { data, reload } = usePoll<Me>("/api/me", 5000);
  if (!data) return <p className="muted">Loading…</p>;

  async function updateMember(householdId: string, m: Member, patch: Partial<Pick<Member, "isEmergencyContact" | "escalationOrder">>) {
    await fetch(`/api/households/${householdId}/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await reload();
  }

  return (
    <>
      <h1>Household & linking</h1>
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
                  <PairingCodeBox householdId={h.id} role="CHILD" botUsername={data.botUsername} />
                )}
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Step 2 — Link your parent's Telegram</h3>
                {parent?.telegramLinked ? (
                  <p><span className="badge ACKNOWLEDGED">Linked</span> {parent.displayName} can now send requests and SOS to the bot.</p>
                ) : (
                  <PairingCodeBox householdId={h.id} role="PARENT" botUsername={data.botUsername} />
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Members & emergency escalation</h3>
              <p className="muted">Level-1 emergency contacts are alerted immediately on SOS. If nobody acknowledges within the configured interval, the next level is alerted, then everyone is re-alerted.</p>
              <table className="responsive">
                <thead><tr><th>Name</th><th>Role</th><th>Telegram</th><th>Emergency contact</th><th>Escalation level</th></tr></thead>
                <tbody>
                  {h.members.map((m) => (
                    <tr key={m.membershipId}>
                      <td data-label="Name">{m.displayName}{m.userId === data.user.id && " (you)"}</td>
                      <td data-label="Role">{m.role === "PARENT" ? "Parent" : "Child"}</td>
                      <td data-label="Telegram">{m.telegramLinked ? (m.botStarted ? <span className="badge SENT">Linked</span> : <span className="badge NEEDS_REVIEW">Bot not started</span>) : <span className="badge">Not linked</span>}</td>
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
