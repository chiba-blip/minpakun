import type { Metadata } from "next";
import { Noto_Sans_JP, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/layout/nav";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "600", "700"],
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "みんぱくん - 民泊投資分析ツール",
  description: "北海道の民泊物件を分析し、収益シミュレーションを行うツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${notoSansJP.variable} ${sourceSans.variable} font-sans antialiased`}
      >
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 bg-gray-50 p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
