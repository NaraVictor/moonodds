import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PredictionDetail } from "@/components/predictions/prediction-detail";

/**
 * One prediction, in full.
 *
 * The public half of the product. Everything a visitor needs to judge the match
 * for themselves, form, head to head, season splits, the factors we weighed,
 * is here regardless of access; what stays behind the pass is our call on it.
 */
export default async function PredictionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PredictionDetail id={id} />
      <SiteFooter />
      <BottomNav />
    </>
  );
}
