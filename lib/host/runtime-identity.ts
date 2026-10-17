import os from "node:os";
import type { InstanceEnvironment, RuntimeIdentity } from "@/lib/contracts/runtime-identity";

export function getRuntimeIdentity(): RuntimeIdentity {
  let serviceUser: string | null = null;
  try { serviceUser = os.userInfo().username || null; } catch { /* The service may have no passwd entry. */ }
  const declaredEnvironment = process.env.OS_INSTANCE_ENVIRONMENT?.trim() ?? "";
  const environment = ["development", "test", "staging", "production"].includes(declaredEnvironment)
    ? declaredEnvironment as InstanceEnvironment : null;
  return {
    hostname: os.hostname(),
    serviceUser,
    runtimeInstanceId: process.env.MSO_RUNTIME_INSTANCE_ID || null,
    environment,
  };
}
