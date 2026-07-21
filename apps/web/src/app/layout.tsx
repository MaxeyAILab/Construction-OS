import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConstructionOS",
  description: "AI-powered Construction Operating System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
