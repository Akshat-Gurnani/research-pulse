import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Shell } from "./Shell";
import { LiquidBackdrop } from "./fx/LiquidBackdrop";

export const metadata: Metadata = { title: "Research Pulse", description: "A weekly AI-research brief, grown all week and delivered on Monday morning." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="backdrop" aria-hidden>
          <LiquidBackdrop />
        </div>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
