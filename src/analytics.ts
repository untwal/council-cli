import * as fs from "fs";
import * as path from "path";
import { listPipelineRuns, PipelineState, RoleMetrics } from "./artifacts";

export interface AgentStats {
  agent: string;
  totalRuns: number;
  totalRoles: number;
  avgDurationMs: number;
  approvalRate: number;  // 0-1
  totalRetries: number;
  rolesUsed: Record<string, number>;  // role name → count
}

export interface AnalyticsReport {
  totalRuns: number;
  totalApproved: number;
  totalRejected: number;
  totalInProgress: number;
  avgPipelineMs: number;
  agentStats: AgentStats[];
  bottleneckRole: string | null;
  avgRoleDurations: Record<string, number>;
}

export function generateAnalytics(repoPath: string): AnalyticsReport {
  const runs = listPipelineRuns(repoPath);

  if (runs.length === 0) {
    return {
      totalRuns: 0, totalApproved: 0, totalRejected: 0, totalInProgress: 0,
      avgPipelineMs: 0, agentStats: [], bottleneckRole: null, avgRoleDurations: {},
    };
  }

  let totalApproved = 0;
  let totalRejected = 0;
  let totalInProgress = 0;
  let totalPipelineMs = 0;
  let completedRuns = 0;

  const agentMap = new Map<string, { durations: number[]; approvals: number; rejections: number; retries: number; roles: Record<string, number> }>();
  const roleDurations = new Map<string, number[]>();

  for (const { state } of runs) {
    if (state.accepted) totalApproved++;
    else if (state.finishedAt) totalRejected++;
    else totalInProgress++;

    if (state.finishedAt) {
      totalPipelineMs += state.finishedAt - state.startedAt;
      completedRuns++;
    }

    for (const metric of state.roleMetrics ?? []) {
      // Track per-agent stats
      if (!agentMap.has(metric.agent)) {
        agentMap.set(metric.agent, { durations: [], approvals: 0, rejections: 0, retries: 0, roles: {} });
      }
      const agentData = agentMap.get(metric.agent)!;
      agentData.durations.push(metric.durationMs);
      agentData.retries += metric.retries;
      agentData.roles[metric.role] = (agentData.roles[metric.role] ?? 0) + 1;

      if (state.accepted) agentData.approvals++;
      else if (state.finishedAt) agentData.rejections++;

      // Track per-role durations
      if (!roleDurations.has(metric.role)) roleDurations.set(metric.role, []);
      roleDurations.get(metric.role)!.push(metric.durationMs);
    }
  }

  // Build agent stats
  const agentStats: AgentStats[] = [];
  for (const [agent, data] of agentMap) {
    const total = data.approvals + data.rejections;
    agentStats.push({
      agent,
      totalRuns: total,
      totalRoles: data.durations.length,
      avgDurationMs: data.durations.reduce((a, b) => a + b, 0) / data.durations.length,
      approvalRate: total > 0 ? data.approvals / total : 0,
      totalRetries: data.retries,
      rolesUsed: data.roles,
    });
  }

  // Sort by approval rate desc, then avg duration asc
  agentStats.sort((a, b) => b.approvalRate - a.approvalRate || a.avgDurationMs - b.avgDurationMs);

  // Find bottleneck role
  const avgRoleDurations: Record<string, number> = {};
  let bottleneckRole: string | null = null;
  let maxAvgDuration = 0;

  for (const [role, durations] of roleDurations) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    avgRoleDurations[role] = avg;
    if (avg > maxAvgDuration) {
      maxAvgDuration = avg;
      bottleneckRole = role;
    }
  }

  return {
    totalRuns: runs.length,
    totalApproved,
    totalRejected,
    totalInProgress,
    avgPipelineMs: completedRuns > 0 ? totalPipelineMs / completedRuns : 0,
    agentStats,
    bottleneckRole,
    avgRoleDurations,
  };
}
