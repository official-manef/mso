export type InstanceEnvironment = "development" | "test" | "staging" | "production";

export type RuntimeIdentity = {
  hostname: string;
  serviceUser: string | null;
  runtimeInstanceId: string | null;
  environment: InstanceEnvironment | null;
};
