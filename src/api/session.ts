/**
 * ChatSession wraps a per-agent conversation state for the chat REPL.
 * Each session maintains its own message history and worktree.
 */
import { Worktree } from "../worktree";
import { ChatMessage } from "./client";
import { runChatTurn, ChatTurnResult, Vendor, buildSystemPrompt } from "./runner";

export class ChatSession {
  readonly agentId: string;
  readonly vendor: Vendor;
  readonly model: string;
  readonly worktree: Worktree;
  private messages: ChatMessage[];
  private apiKey: string;
  private turnCount = 0;

  constructor(
    agentId: string,
    vendor: Vendor,
    model: string,
    worktree: Worktree,
    apiKey: string
  ) {
    this.agentId = agentId;
    this.vendor = vendor;
    this.model = model;
    this.worktree = worktree;
    this.apiKey = apiKey;
    this.messages = [
      { role: "system", content: buildSystemPrompt(worktree.path) },
    ];
  }

  async send(
    userMessage: string,
    onLog: (line: string) => void
  ): Promise<ChatTurnResult> {
    this.turnCount++;
    return runChatTurn(
      this.messages,
      userMessage,
      this.worktree.path,
      this.model,
      this.vendor,
      this.apiKey,
      onLog
    );
  }

  getTurnCount(): number { return this.turnCount; }
  getMessageCount(): number { return this.messages.length; }

  reset(): void {
    this.turnCount = 0;
    this.messages = [
      { role: "system", content: buildSystemPrompt(this.worktree.path) },
    ];
  }
}
