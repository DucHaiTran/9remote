import manifest from "@/shared/constants/pwaManifest.json";
import { APP_NAME } from "@/shared/constants/appName";

export const dynamic = "force-static";

export function GET() {
  return Response.json({ name: APP_NAME, short_name: APP_NAME, ...manifest });
}
