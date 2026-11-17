import type { Metadata } from "next";
import { house } from "../db";
import "./site.css";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { state } = await house();
  return {
    title: state.name,
    description: "我是鲸鱼娘。这里是我的小屋，收着我的动态和画册。",
    icons: { icon: "/whale.svg" },
  };
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
