import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Debug AI",
  description: "AI powered code analyzer and debugging assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}