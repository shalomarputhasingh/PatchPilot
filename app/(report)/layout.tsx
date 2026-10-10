import type { Metadata } from "next";
import "./report.css";

// Separate root layout: the report does not load the website's global stylesheet.
export const metadata: Metadata = { title: "PatchPilot — Web Technology Mini Project Report" };

export default function ReportRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
