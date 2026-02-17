/**
 * RalphX TUI — Ink-based interactive terminal UI.
 *
 * Requires: npm install ink ink-select-input react
 *
 * This file provides the top-level Ink application component.
 * It reads from the event bus (or events.jsonl for attach mode)
 * and renders a live dashboard.
 */

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import type { RunState } from "../state/types";
import type { RalphxEvent } from "../monitor/types";
import type { EventBus } from "../monitor/event-bus";
import { createInitialTuiState, applyEvent, type TuiState } from "./store";

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

function LogViewer({ logs }: { logs: TuiState["logs"] }) {
  const visible = logs.slice(-10);
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

function CommandBar() {
  return (
    <Box paddingX={1}>
      <Text color="gray">
        [l]logs [s]status [p]progress [d]decisions [q]quit
      </Text>
    </Box>
  );
}

function Dashboard({ initialState, eventBus }: DashboardProps) {
  const [tuiState, setTuiState] = useState<TuiState>(
    createInitialTuiState(initialState),
  );
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

  useInput((input, key) => {
    if (input === "q") {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <StatusBar state={tuiState} />
      <Box>
        <AgentList agents={tuiState.agents} />
        <TaskList tasks={tuiState.tasks} />
      </Box>
      <LogViewer logs={tuiState.logs} />
      <CommandBar />
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
