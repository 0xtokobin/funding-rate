/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // 关闭严格模式，避免双重渲染
  // 禁用 webpack HMR (Hot Module Replacement)
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.watchOptions = {
        ...config.watchOptions,
        poll: false,
        followSymlinks: false,
      };
    }
    if (!isServer) {
      // 客户端webpack配置
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        dns: false,
      };
    }
    return config;
  },
  // 添加自定義 headers 來防止不必要的請求
  async headers() {
    return [
      {
        source: '/socket.io/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        // Binance Futures API 重寫
        source: '/api/binance/funding-rates',
        destination: 'https://fapi.binance.com/fapi/v1/premiumIndex'
      },
      {
        // Bybit API 重寫 
        source: '/api/bybit/funding-rates',
        destination: 'https://api.bybit.com/v5/market/tickers'
      },
      {
        // Bitget API 重寫
        source: '/api/bitget/funding-rates', 
        destination: 'https://api.bitget.com/api/v2/mix/market/tickers'
      }
    ];
  },
  // 增加API请求体限制（如果需要）
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    // 禁用API路由的正文解析（WebSocket需要）
    externalResolver: true,
  },
  output: 'export',  // 启用静态导出
  images: {
    unoptimized: true, // 为了静态导出，需要禁用图片优化
  },
  assetPrefix: process.env.NODE_ENV === 'production' ? '/funding-rate' : '', // 使用实际的仓库名
  basePath: process.env.NODE_ENV === 'production' ? '/funding-rate' : '', // 使用实际的仓库名
}

module.exports = nextConfig