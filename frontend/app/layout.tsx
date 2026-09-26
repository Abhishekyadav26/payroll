import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veiled Payroll — Private Payroll on Midnight",
  description: "Distribute funds without exposing amounts. Salaries stay shielded; the ledger holds only commitments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">◈</span> Veiled Payroll
          </a>
          <nav>
            <a href="/employer">Employer</a>
            <a href="/employee">Employee</a>
            <a href="/auditor">Auditor</a>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Private payroll demo on Midnight Network — amounts are shielded, commitments are public.
        </footer>
      </body>
    </html>
  );
}
