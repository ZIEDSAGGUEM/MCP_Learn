import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsureBot Security Lab",
  description: "Call InsureBot's tools, replay the attacks, and see the evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
