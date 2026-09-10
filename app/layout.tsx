import type { Metadata } from "next";
import { Barlow, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scanrr — Free AI Visibility Checker",
  description: "Check where your brand appears on ChatGPT, Perplexity, Gemini & Claude. Free AI visibility scan — see your score in 60 seconds.",
  metadataBase: new URL("https://scanrr.sparrwo.com"),
  alternates: {
    canonical: "https://scanrr.sparrwo.com",
  },
  openGraph: {
    title: "Scanrr — Free AI Visibility Checker",
    description: "Check where your brand appears on ChatGPT, Perplexity, Gemini & Claude. Free AI visibility scan — see your score in 60 seconds.",
    url: "https://scanrr.sparrwo.com",
    siteName: "Scanrr by Sparrwo",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "https://scanrr.sparrwo.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Scanrr — Free AI Visibility Checker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scanrr — Free AI Visibility Checker",
    description: "Check where your brand appears on ChatGPT, Perplexity, Gemini & Claude. Free scan in 60 seconds.",
    images: ["https://scanrr.sparrwo.com/og-image.png"],
  },
  keywords: [
    "AI visibility checker",
    "AI search visibility",
    "ChatGPT brand visibility",
    "Perplexity brand ranking",
    "AI search ranking tool",
    "brand visibility AI",
    "AEO tool",
    "answer engine optimization",
    "LLM visibility scanner",
    "AI citation checker",
  ],
  verification: {
    google: "dZnpzpjEmnmFTxixWO-GLe4k0BXHBFlhUmeHhnI71_g",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
