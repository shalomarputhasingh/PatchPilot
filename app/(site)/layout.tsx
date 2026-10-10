import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PatchPilot — Find the bug. Fix the code. Prove it works.",
  description: "AI-powered Python debugging workbench that proposes a patch and verifies it by running it in a sandbox.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0d0f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
