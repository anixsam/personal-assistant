import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jarvis",
  description: "Personal assistant: NVIDIA NIM first, Claude on approval.",
};

export const viewport: Viewport = { themeColor: "#070b12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
