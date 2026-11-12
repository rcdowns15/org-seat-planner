import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Org Seat Planner · Second Republic Bank (fictional)",
  description: "Demo write-back app for planning org and seats. All data is mock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
