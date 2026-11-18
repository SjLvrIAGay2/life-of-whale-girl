import { links } from "../config/links.ts";
import { texts } from "../config/texts";
import type { Metadata } from "next";
import { house } from "../db";
import "./site.css";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { state } = await house();
  return {
    title: state.name,
    description: texts.read(state.config).siteDescription,
    icons: { icon: links.read(state.config).favicon },
    alternates: {types: {"application/rss+xml":links.read(state.config).feed}},
  };
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
