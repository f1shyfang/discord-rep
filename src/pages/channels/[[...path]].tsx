import { AuthGate } from "~/components/chat/AuthGate";
import { Workspace } from "~/components/chat/Workspace";
export default function ChannelsPage() {
  return <AuthGate>{(profile) => <Workspace profile={profile} />}</AuthGate>;
}
