import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'polizy',
  tagline: 'Zanzibar-inspired authorization for TypeScript & Node.js',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here.
  // TODO: confirm the final docs domain (assumed polizy.dev).
  url: 'https://polizy.dev',
  // Set the /<baseUrl>/ pathname under which your site is served.
  baseUrl: '/',

  organizationName: 'bratsos',
  projectName: 'polizy',

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl:
            'https://github.com/bratsos/polizy/tree/main/apps/docs/',
          async sidebarItemsGenerator({defaultSidebarItemsGenerator, ...args}) {
            const sidebarItems = await defaultSidebarItemsGenerator(args);
            const transformItems = (items: any[]) => {
              const polizyCategory = items.find(item => item.type === 'category' && item.label === 'polizy');
              if (polizyCategory && polizyCategory.items) {
                const prismaStorageIndex = polizyCategory.items.findIndex(item => item.type === 'category' && (item.label === 'prisma-storage' || item.label === 'polizy/prisma-storage'));
                if (prismaStorageIndex !== -1) {
                  const [prismaStorageCategory] = polizyCategory.items.splice(prismaStorageIndex, 1);
                  prismaStorageCategory.label = 'polizy/prisma-storage';
                  const polizyIndex = items.indexOf(polizyCategory);
                  items.splice(polizyIndex + 1, 0, prismaStorageCategory);
                }
              }
              for (const item of items) {
                if (item.type === 'category' && item.items) {
                  transformItems(item.items);
                }
              }
              return items;
            };
            return transformItems(sidebarItems);
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-typedoc',
      {
        name: 'API Reference',
        entryPoints: [
          '../../packages/polizy/src/index.ts',
          '../../packages/polizy/src/polizy.prisma.storage.ts',
        ],
        tsconfig: './typedoc.tsconfig.json',
        out: 'docs/api',
        excludeInternal: true,
        // Make the generated section sort last and read as "API Reference":
        sidebar: { pretty: true },
      },
    ]
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'polizy',
      logo: {
        alt: 'polizy logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/demos',
          label: 'Demos',
          position: 'left',
        },
        {
          to: '/api/',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: 'https://github.com/bratsos/polizy',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/',
            },
            {
              label: 'Quickstart',
              to: '/getting-started/quickstart',
            },
            {
              label: 'API Reference',
              to: '/api/',
            },
          ],
        },
        {
          title: 'Try it',
          items: [
            {
              label: 'Live Demo',
              to: '/demos/live-demo',
            },
            {
              label: 'Permissions Matrix',
              to: '/demos/permissions-matrix',
            },
            {
              label: 'Scale Benchmark',
              to: '/demos/scale-benchmark',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/bratsos/polizy',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/polizy',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} polizy. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
