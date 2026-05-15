import type { NextRequest } from "next/server";
import { getReport } from "@/lib/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const report = await getReport(slug);
  if (!report) return new Response("Not found", { status: 404 });

  return new Response(report.contentMd, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="cbt-${slug}.md"`,
    },
  });
}
