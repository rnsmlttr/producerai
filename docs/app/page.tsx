import { Link } from "lib/transition"

import Image from "next/image"
import { PageRoutes } from "@/lib/pageroutes"
import { buttonVariants } from "@/components/ui/button"

export default function Home() {
  return (
    <section className="flex min-h-[86.5vh] flex-col items-center justify-center px-2 py-8 text-center">
      <h1 className="mb-4 text-4xl font-bold sm:text-7xl">Meet Producer</h1>
      <p className="mb-8 max-w-[600px] text-foreground sm:text-base">
        Producer.ai is your creative partner, music theory savant, and vibe curator in the Studio.
      </p>
      
      <div className="flex items-center gap-5">
        <Link
          href={`/docs${PageRoutes[0].href}`}
          className={buttonVariants({ className: "px-6", size: "lg" })}
        >
          Jump In
        </Link>
      </div>
    </section>
  )
}
