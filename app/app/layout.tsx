import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";

export const metadata: Metadata = {
  title: "ShieldFlow",
  description: "AI-powered GRC compliance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
