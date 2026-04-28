/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config, { isServer }) => {
        if (!isServer) {
            config.optimization.splitChunks = {
                chunks: 'all',
                cacheGroups: {
                    stellar: {
                        test: /[\\/]node_modules[\\/](@stellar|stellar-sdk|@soroban-react)[\\/]/,
                        name: 'stellar-sdk',
                        priority: 30,
                        reuseExistingChunk: true,
                    },
                    wallets: {
                        test: /[\\/]node_modules[\\/](freighter-api|@albedo-link|rabet)[\\/]/,
                        name: 'wallet-adapters',
                        priority: 25,
                        reuseExistingChunk: true,
                    },
                    charts: {
                        test: /[\\/]node_modules[\\/](recharts|d3|victory|tremor)[\\/]/,
                        name: 'charts',
                        priority: 20,
                        reuseExistingChunk: true,
                    },
                    framework: {
                        test: /[\\/]node_modules[\\/](react|react-dom|next)[\\/]/,
                        name: 'framework',
                        priority: 40,
                        reuseExistingChunk: true,
                    },
                },
            }
        }
        return config
    },
}
module.exports = nextConfig