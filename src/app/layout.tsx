import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { requirePageAccess } from "@/auth/page-access";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MARCOM — Multi-Agent Researcher Communicator",
  description:
    "From research to real connections. MARCOM uses specialized AI agents to research, personalize, and help you reach the right people.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requirePageAccess();
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${playfair.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#08080c]" suppressHydrationWarning>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </body>
    </html>
  );
}
