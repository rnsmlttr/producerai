import { Paths } from "@/lib/pageroutes"

export const Documents: Paths[] = [
  {
    heading: "Getting Started",
    title: "Introduction",
    href: "/getting-started/introduction",
    items: [
      {
        title: "The FUZZ Engine",
        href: "/getting-started/fuzz-engine",
      },
    ],
  },
  {
    spacer: true,
  },
  {
    heading: "Core Platform",
    title: "Studio Interface",
    href: "/core-platform/studio-interface",
    items: [
      {
        title: "Tools & Features",
        href: "/core-platform/tools-features",
      },
    ],
  },
  {
    spacer: true,
  },
  {
    heading: "Guides",
    title: "Songwriting Guide",
    href: "/guides/songwriting-guide",
    items: [
      {
        title: "Licensing",
        href: "/guides/licensing",
      },
    ],
  },
]
