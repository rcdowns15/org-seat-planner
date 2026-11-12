import { NextResponse } from "next/server";
import { checkDatabase } from "@/server/health";

// Never prerender: the answer depends on the database at request time.
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await checkDatabase();
  return NextResponse.json(body, { status });
}
