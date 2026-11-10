import { appShell } from "@/lib/appPage";
import { TravelPage } from "@/components/travel/TravelPage";

export const dynamic = "force-dynamic";

export default async function Travel() {
  const { settings, background } = await appShell("travel");
  return (
    <>
      {background}
      <TravelPage colors={{ visited: settings.travel.visitedColor, lived: settings.travel.livedColor, want: settings.travel.wantColor }} />
    </>
  );
}
