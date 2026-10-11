import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Research Pulse", description: "A weekly AI-research brief, grown all week and delivered on Monday morning." };
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><main>
    <nav><a href="/">Latest brief</a><a href="/status">Status</a><a href="/settings">Domains</a><a href="/brief/feed.xml">Feed</a></nav>
    {children}
    <p className="meta" style={{ marginTop: 60 }}>Summaries are generated from abstracts only by Gemini Flash and checked against them in code. Not peer reviewed. Paper metadata courtesy of arXiv.</p>
  </main></body></html>);
}
