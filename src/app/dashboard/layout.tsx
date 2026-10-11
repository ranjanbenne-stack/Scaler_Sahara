import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/http";
import { getConfig } from "@/lib/env";
import EmergencyBanner from "@/components/EmergencyBanner";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const demo = getConfig().DEMO_MODE;

  return (
    <>
      {demo && <div className="demo-banner">DEMO MODE — records labelled [DEMO] are sample data, not live requests</div>}
      <header className="topbar">
        <div className="shell">
          <span className="brand">SAHARA</span>
          <nav className="row main-nav">
            <Link href="/dashboard">Home</Link>
            <Link href="/dashboard/requests">Requests</Link>
            <Link href="/dashboard/household">Household</Link>
          </nav>
          <span className="muted" style={{ color: "rgba(255,255,255,0.8)" }}>{user.displayName}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="shell">
        <EmergencyBanner />
        {children}
      </main>
      <nav className="tabbar">
        <Link href="/dashboard">Home</Link>
        <Link href="/dashboard/requests">Requests</Link>
        <Link href="/dashboard/household">Household</Link>
      </nav>
    </>
  );
}
