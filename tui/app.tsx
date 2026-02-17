/**
 * RalphX TUI — Ink-based interactive terminal UI.
 *
 * Requires: npm install ink ink-select-input react
 *
 * This file provides the top-level Ink application component.
 * It reads from the event bus (or events.jsonl for attach mode)
 * and renders a live dashboard.
 */

import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import type { RunState } from "../state/types";
import type { RalphxEvent } from "../monitor/types";
import type { EventBus } from "../monitor/event-bus";
import { createInitialTuiState, applyEvent, type TuiState } from "./store";

type ActiveView = "default" | "logs" | "status" | "progress" | "decisions";

interface DashboardProps {
  initialState: RunState;
  eventBus?: EventBus;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

function StatusBar({ state }: { state: TuiState }) {
  return (
    <Box
      borderStyle="single"
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Text bold color="cyan">
        {" "}
        RalphX{" "}
      </Text>
      <Text>Run: {state.runId}</Text>
      <Text>{state.runtime}</Text>
      <Text>{formatElapsed(state.elapsedMs)}</Text>
      <Text>
        Status:{" "}
        <Text
          color={
            state.status === "completed"
              ? "green"
              : state.status === "blocked"
                ? "red"
                : "yellow"
          }
        >
          {state.status.toUpperCase()}
        </Text>
      </Text>
      <Text>
        Phase {state.currentPhaseIndex + 1}/{state.totalPhases}
      </Text>
      <Text>
        Task {state.currentTaskIndex}/{state.totalTasks}
      </Text>
    </Box>
  );
}

function AgentList({ agents }: { agents: TuiState["agents"] }) {
  return (
    <Box flexDirection="column" width="50%">
      <Text bold underline>
        AGENTS
      </Text>
      {agents.map((agent) => (
        <Box key={agent.id}>
          <Text color={agent.status === "running" ? "green" : "gray"}>
            {agent.status === "running" ? "*" : " "}
          </Text>
          <Text> {agent.name.padEnd(5)}</Text>
          <Text
            color={
              agent.status === "running"
                ? "green"
                : agent.status === "failed"
                  ? "red"
                  : "gray"
            }
          >
            [{agent.status}]
          </Text>
          {agent.taskId && <Text> {agent.taskId}</Text>}
          {agent.elapsedMs && <Text> {formatElapsed(agent.elapsedMs)}</Text>}
        </Box>
      ))}
    </Box>
  );
}

function TaskList({ tasks }: { tasks: TuiState["tasks"] }) {
  return (
    <Box flexDirection="column" width="50%">
      <Text bold underline>
        TASKS
      </Text>
      {tasks.map((task) => (
        <Box key={task.id}>
          <Text> {task.id} </Text>
          <Text
            color={
              task.status === "passed"
                ? "green"
                : task.status === "running"
                  ? "yellow"
                  : task.status === "blocked"
                    ? "red"
                    : task.status === "failed"
                      ? "red"
                      : "gray"
            }
          >
            [{task.status}]
          </Text>
          {task.commit && <Text> {task.commit}</Text>}
          {task.attempt && <Text> att {task.attempt}</Text>}
        </Box>
      ))}
    </Box>
  );
}

function LogViewer({
  logs,
  expanded,
}: {
  logs: TuiState["logs"];
  expanded?: boolean;
}) {
  const visible = logs.slice(expanded ? -30 : -10);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold underline>
        LOGS
      </Text>
      {visible.map((log, i) => (
        <Text key={i}>
          <Text color="gray">[{log.ts.slice(11, 19)}]</Text>
          <Text color="cyan"> {log.source}</Text>
          <Text> {log.message}</Text>
        </Text>
      ))}
      {visible.length === 0 && <Text color="gray"> (no logs yet)</Text>}
    </Box>
  );
}

function StatusDetail({ state }: { state: TuiState }) {
  const running = state.agents.filter((a) => a.status === "running").length;
  const completed = state.agents.filter((a) => a.status === "completed").length;
  const failed = state.agents.filter((a) => a.status === "failed").length;
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold underline>
        STATUS
      </Text>
      <Text>
        Run ID: <Text color="cyan">{state.runId}</Text>
      </Text>
      <Text>
        Runtime: <Text color="cyan">{state.runtime}</Text>
      </Text>
      <Text>
        Status:{" "}
        <Text
          color={
            state.status === "completed"
              ? "green"
              : state.status === "blocked"
                ? "red"
                : "yellow"
          }
        >
          {state.status.toUpperCase()}
        </Text>
      </Text>
      <Text>Elapsed: {formatElapsed(state.elapsedMs)}</Text>
      <Text>
        Agents — running: {running} completed: {completed} failed: {failed}
      </Text>
      <Text>
        Phase: {state.currentPhaseIndex + 1}/{state.totalPhases}
      </Text>
      <Text>
        Tasks completed: {state.currentTaskIndex}/{state.totalTasks}
      </Text>
    </Box>
  );
}

function ProgressView({ state }: { state: TuiState }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold underline>
        PROGRESS
      </Text>
      <Text>
        Phase {state.currentPhaseIndex + 1} of {state.totalPhases}
      </Text>
      <Text> </Text>
      {state.tasks.map((task) => {
        const icon =
          task.status === "passed"
            ? "+"
            : task.status === "running"
              ? ">"
              : task.status === "failed" || task.status === "blocked"
                ? "x"
                : "-";
        const color =
          task.status === "passed"
            ? "green"
            : task.status === "running"
              ? "yellow"
              : task.status === "failed" || task.status === "blocked"
                ? "red"
                : "gray";
        return (
          <Text key={task.id}>
            <Text color={color}>
              [{icon}] {task.id}
            </Text>
            <Text> {task.title}</Text>
            {task.commit && <Text color="gray"> ({task.commit})</Text>}
            {task.error && <Text color="red"> — {task.error}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}

function DecisionsView({
  decisions,
}: {
  decisions: TuiState["recentDecisions"];
}) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold underline>
        DECISIONS
      </Text>
      {decisions.map((d, i) => (
        <Box key={i} flexDirection="column">
          <Text>
            <Text color="gray">[{d.ts.slice(11, 19)}]</Text>
            {d.taskId && <Text color="cyan"> {d.taskId}</Text>}
            <Text bold> {d.action}</Text>
          </Text>
          {d.rationale && <Text color="gray"> {d.rationale}</Text>}
        </Box>
      ))}
      {decisions.length === 0 && <Text color="gray"> (no decisions yet)</Text>}
    </Box>
  );
}

function CommandBar({ activeView }: { activeView: ActiveView }) {
  const items: { key: string; label: string; view: ActiveView }[] = [
    { key: "l", label: "logs", view: "logs" },
    { key: "s", label: "status", view: "status" },
    { key: "p", label: "progress", view: "progress" },
    { key: "d", label: "decisions", view: "decisions" },
  ];
  return (
    <Box paddingX={1}>
      {items.map((item) => (
        <Text key={item.key}>
          <Text color={activeView === item.view ? "cyan" : "gray"}>
            [{item.key}]{item.label}
          </Text>
          <Text> </Text>
        </Text>
      ))}
      <Text color="gray">[q]quit</Text>
    </Box>
  );
}

function Dashboard({ initialState, eventBus }: DashboardProps) {
  const [tuiState, setTuiState] = useState<TuiState>(
    createInitialTuiState(initialState),
  );
  const [activeView, setActiveView] = useState<ActiveView>("default");
  const { exit } = useApp();

  useEffect(() => {
    if (!eventBus) return;
    const unsubscribe = eventBus.on("*", (event: RalphxEvent) => {
      setTuiState((prev) => applyEvent(prev, event));
    });
    return unsubscribe;
  }, [eventBus]);

  // Tick for elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setTuiState((prev) => ({
        ...prev,
        elapsedMs: Date.now() - new Date(prev.startedAt).getTime(),
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const viewKeys: Record<string, ActiveView> = {
    l: "logs",
    s: "status",
    p: "progress",
    d: "decisions",
  };

  useInput((input) => {
    if (input === "q") {
      exit();
      return;
    }
    const target = viewKeys[input];
    if (target) {
      setActiveView((prev) => (prev === target ? "default" : target));
    }
  });

  const renderMainPanel = () => {
    switch (activeView) {
      case "logs":
        return <LogViewer logs={tuiState.logs} expanded />;
      case "status":
        return <StatusDetail state={tuiState} />;
      case "progress":
        return <ProgressView state={tuiState} />;
      case "decisions":
        return <DecisionsView decisions={tuiState.recentDecisions} />;
      default:
        return (
          <>
            <Box>
              <AgentList agents={tuiState.agents} />
              <TaskList tasks={tuiState.tasks} />
            </Box>
            <LogViewer logs={tuiState.logs} />
          </>
        );
    }
  };

  return (
    <Box flexDirection="column">
      <StatusBar state={tuiState} />
      {renderMainPanel()}
      <CommandBar activeView={activeView} />
    </Box>
  );
}

export function renderTui(params: {
  initialState: RunState;
  eventBus?: EventBus;
}): void {
  render(
    <Dashboard initialState={params.initialState} eventBus={params.eventBus} />,
  );
}
