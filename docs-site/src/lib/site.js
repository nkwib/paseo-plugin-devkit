// Links and navigation shared by the header, footer, sidebar and pages.
export const REPO = 'https://github.com/nkwib/paseo-plugin-devkit';
export const NPM = 'https://www.npmjs.com/package/paseo-plugin-devkit';
export const PASEO = 'https://github.com/getpaseo/paseo';
// Placeholder until the Cloudflare Pages project exists; the project name decides the subdomain.
export const SITE = 'https://paseo-plugin-devkit.pages.dev';
export const blob = (path) => `${REPO}/blob/main/${path}`;
export const tree = (path) => `${REPO}/tree/main/${path}`;

export const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/docs/commands', label: 'Commands' },
  { href: '/docs/recipes', label: 'Recipes' },
  { href: '/docs/safety', label: 'Safety' }
];

export const SECTIONS = [
  {
    label: 'Guide',
    items: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/docs/check', label: 'Host-contract checks' },
      { href: '/docs/fake-agent', label: 'Fake agent' },
      { href: '/docs/android', label: 'Testing on a phone' },
      { href: '/docs/safety', label: 'Safety model' }
    ]
  },
  {
    label: 'Recipes',
    items: [
      { href: '/docs/recipes', label: 'Overview' },
      { href: '/docs/recipes/timeline-renderer', label: 'Timeline renderer' },
      { href: '/docs/recipes/settings', label: 'Settings screen' },
      { href: '/docs/recipes/server-hooks', label: 'Server hooks' }
    ]
  },
  {
    label: 'Reference',
    items: [
      { href: '/docs/commands', label: 'Commands' },
      { href: '/docs/troubleshooting', label: 'Troubleshooting' },
      { href: '/docs/compatibility', label: 'Compatibility' },
      { href: '/docs/changelog', label: 'Changelog' }
    ]
  }
];

/** The nav or sidebar entry for a path: the longest href that is the path or a parent of it. */
export function activeHref(hrefs, pathname) {
  const matches = hrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}
