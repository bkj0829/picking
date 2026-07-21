export default function manifest() {
  return {
    name: "세븐밸리 피킹 대시보드",
    short_name: "피킹현황",
    description: "실시간 피킹 현황 관리자 대시보드",
    start_url: "/monitor?compact=1",
    scope: "/",
    display: "standalone",
    background_color: "#0d1422",
    theme_color: "#142036",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  };
}
