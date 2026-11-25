import type { MetadataRoute } from 'next'

// #535: only the public landing page is meant to be indexed. The dashboard,
// contract and settings routes render per-browser data from localStorage, and
// the API routes are not documents, so crawlers are kept out of them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/contracts', '/settings'],
    },
  }
}
