import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { PageLoad } from "./$types";

// Every title now has one details page. Keep older /anime/ links working.
export const load: PageLoad = ({ params }) => {
  redirect(307, `${base}/media/${params.id}`);
};
