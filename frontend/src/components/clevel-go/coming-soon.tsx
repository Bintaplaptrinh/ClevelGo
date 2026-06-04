import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type ComingSoonProps = {
  title: string;
};

export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 text-slate-950">
      <section className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-white shadow-[0_18px_60px_rgba(29,121,242,0.18)]">
          <Image
            src="/clevelgo_logo.jpg"
            alt="Clevel Go logo"
            width={46}
            height={46}
            className="rounded-xl"
            priority
          />
        </div>
        <p className="text-sm font-medium text-[#1D79F2]">Clevel Go</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">Coming soon.</p>
        <Link
          href="/"
          className="mx-auto mt-7 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2]"
        >
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>
      </section>
    </main>
  );
}
