import type { Metadata } from "next";
import { LinkButton } from "@/components/links";
import { StatusScreen } from "@/components/status-screen";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <StatusScreen title="We couldn't find that" actions={<LinkButton href="/work">Go to My work</LinkButton>}>
      The link may be wrong, or the record was removed. Try searching for it instead.
    </StatusScreen>
  );
}
