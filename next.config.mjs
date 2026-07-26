/** @type {import('next').NextConfig} */
const nextConfig = {
  // CSAT 기출 지문을 담고 있으므로 어떤 경로도 검색엔진에 노출되면 안 된다.
  // robots.txt 와 별개로 헤더에서도 막는다(계획서 M7 접근 제어).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ]
  },
}

export default nextConfig
