import { Users } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const agentGroupApp: AppDescriptor = {
  id: "agent-group",
  title: "Agent groups",
  icon: Users,
  gradient: "var(--primary)",
  load: () => import("./app"),
  defaultSize: { w: 1120, h: 760 },
};
