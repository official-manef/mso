import { describe, expect, it } from "vitest";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { scheduleBucket } from "./schedule";
const node=(config:Record<string,unknown>):WorkflowGraphNode=>({id:"schedule",name:"Schedule",type:"schedule",position:{x:0,y:0},config});
describe("workflow schedule",()=>{
 it("matches deterministic minute intervals",()=>{const now=new Date("2026-09-15T05:30:00Z");expect(scheduleBucket(node({mode:"interval",everyMinutes:15}),now,"UTC")).toBeTruthy();expect(scheduleBucket(node({mode:"interval",everyMinutes:7}),now,"UTC")).toBeNull();});
 it("matches five-field cron in the configured timezone",()=>{const now=new Date("2026-09-15T05:30:00Z");expect(scheduleBucket(node({mode:"cron",cron:"30 12 * * *",timezone:"Asia/Jakarta"}),now,"UTC")).toContain("Asia/Jakarta");expect(scheduleBucket(node({mode:"cron",cron:"31 12 * * *",timezone:"Asia/Jakarta"}),now,"UTC")).toBeNull();});
 it("rejects malformed cron fields",()=>expect(()=>scheduleBucket(node({mode:"cron",cron:"* * *"}),new Date(),"UTC")).toThrow("5 fields"));
 it("has one immutable occurrence before, at and after the specified instant",()=>{
  const config={mode:"runAt",runAt:"2026-10-19T09:00:30+07:00",missedPolicy:"run_once"};
  expect(scheduleBucket(node(config),new Date("2026-10-19T02:00:29.999Z"))).toBeNull();
  const id=scheduleBucket(node(config),new Date("2026-10-19T02:00:30Z"));expect(id).toBe("runAt:2026-10-19T02:00:30.000Z");
  expect(scheduleBucket(node(config),new Date("2027-01-01T00:00:00Z"))).toBe(id);
  expect(scheduleBucket(node({...config,runAt:"2026-10-19T02:00:30Z",timezone:"America/New_York"}),new Date("2027-01-01T00:00:00Z"))).toBe(id);
 });
 it("keeps legacy AND and makes new cron OR explicit for restricted day fields",()=>{
  const config={mode:"cron",cron:"0 9 1 * 1",timezone:"UTC"};
  expect(scheduleBucket(node(config),new Date("2026-10-01T09:00:00Z"))).toBeNull();
  expect(scheduleBucket(node({...config,dayMatch:"and"}),new Date("2027-02-01T09:00:00Z"))).toBeTruthy();
  for(const at of ["2026-10-01T09:00:00Z","2026-10-05T09:00:00Z"])expect(scheduleBucket(node({...config,dayMatch:"or"}),new Date(at))).toBeTruthy();
  expect(scheduleBucket(node({...config,dayMatch:"or"}),new Date("2026-10-06T09:00:00Z"))).toBeNull();
  expect(scheduleBucket(node({...config,cron:"0 9 * * 1",dayMatch:"or"}),new Date("2026-10-06T09:00:00Z"))).toBeNull();
 });
 it("uses real timezone instants across skipped and repeated daylight-saving hours",()=>{
  const config={mode:"cron",cron:"30 2 * * *",timezone:"America/New_York"};
  expect(scheduleBucket(node(config),new Date("2026-03-08T07:30:00Z"))).toBeNull();
  const repeated={...config,cron:"30 1 * * *"},first=scheduleBucket(node(repeated),new Date("2026-11-01T05:30:00Z")),second=scheduleBucket(node(repeated),new Date("2026-11-01T06:30:00Z"));
  expect(first).toBeTruthy();expect(second).toBeTruthy();expect(second).not.toBe(first);
 });
 it("rejects malformed later cron fields even when the minute would not match",()=>expect(()=>scheduleBucket(node({mode:"cron",cron:"0 0 99 * *"}),new Date("2026-10-19T02:01:00Z"))).toThrow("cron field"));
});
