import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">
        Org Seat Planner · Second Republic Bank (fictional)
      </h1>
      <p className="text-muted-foreground mt-2">All data on this site is mock data.</p>
      <p className="mt-4">
        <Link href="/board" className="underline">
          Open the org board
        </Link>
      </p>
    </main>
  );
}
