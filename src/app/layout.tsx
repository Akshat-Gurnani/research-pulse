import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Shell } from "./Shell";

export const metadata: Metadata = { title: "Research Pulse", description: "A weekly AI-research brief, grown all week and delivered on Monday morning." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="backdrop" aria-hidden>
          <div className="blob b1" /><div className="blob b2" /><div className="blob b3" /><div className="blob b4" />
        </div>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
