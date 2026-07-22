import Link from "next/link";
import { Button } from "@constructionos/ui";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-display font-semibold text-neutral-900">ConstructionOS</h1>
      <p className="max-w-md text-md text-neutral-500">AI-powered Construction Operating System.</p>
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
