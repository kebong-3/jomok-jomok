import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/llm': ['./data/knowledge/corpus.json.gz'],
    '/api/diag': ['./data/knowledge/corpus.json.gz'],
    '/api/knowledge/*': ['./data/knowledge/corpus.json.gz'],
  },
};
export default nextConfig;
