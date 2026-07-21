import "./globals.css";

export const metadata = {
  title: "세븐밸리 피킹",
  description: "다중 작업자 실시간 모바일 피킹 시스템",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "피킹 대시보드",
    statusBarStyle: "black-translucent"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
