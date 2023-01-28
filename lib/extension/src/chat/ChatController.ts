import { util, webviewApi } from "@rubberduck/common";
import * as vscode from "vscode";
import { OpenAIClient } from "../openai/OpenAIClient";
import { ChatModel } from "./ChatModel";
import { ChatPanel } from "./ChatPanel";
import { ConversationModel } from "./ConversationModel";
import { ExplainCodeConversationModel } from "./ExplainCodeConversationModel";
import { FreeConversationModel } from "./FreeConversationModel";
import { GenerateTestConversationModel } from "./GenerateTestConversationModel";

export class ChatController {
  private readonly chatPanel: ChatPanel;
  private readonly chatModel: ChatModel;
  private readonly openAIClient: OpenAIClient;

  private readonly nextChatId: () => string;

  constructor({
    chatPanel,
    chatModel,
    openAIClient,
  }: {
    chatPanel: ChatPanel;
    chatModel: ChatModel;
    openAIClient: OpenAIClient;
  }) {
    this.chatPanel = chatPanel;
    this.chatModel = chatModel;
    this.openAIClient = openAIClient;

    this.nextChatId = util.createNextId({ prefix: "chat-" });
  }

  private async updateChatPanel() {
    await this.chatPanel.update(this.chatModel);
  }

  private async addAndShowConversation<T extends ConversationModel>(
    conversation: T
  ): Promise<T> {
    this.chatModel.addAndSelectConversation(conversation);

    await this.showChatPanel();
    await this.updateChatPanel();

    return conversation;
  }

  private async showChatPanel() {
    await vscode.commands.executeCommand("rubberduck.chat.focus");
  }

  private getSelectedTextFromActiveEditor() {
    const activeEditor = vscode.window.activeTextEditor;
    const document = activeEditor?.document;
    const range = activeEditor?.selection;
    const selectedText = document?.getText(range);

    return (selectedText?.length ?? 0) > 0 ? selectedText : undefined;
  }

  private getActiveEditorSelectionInput() {
    const activeEditor = vscode.window.activeTextEditor;
    const document = activeEditor?.document;
    const range = activeEditor?.selection;

    if (range == null || document == null) {
      return undefined;
    }

    const selectedText = this.getSelectedTextFromActiveEditor();
    const filename = document.fileName.split("/").pop();

    if (selectedText == undefined || filename == undefined) {
      return undefined;
    }

    return {
      filename,
      range,
      selectedText,
    };
  }

  async receivePanelMessage(rawMessage: unknown) {
    const message = webviewApi.outgoingMessageSchema.parse(rawMessage);
    const type = message.type;

    switch (type) {
      case "clickCollapsedExplanation": {
        this.chatModel.selectedConversationIndex = message.data.index;
        await this.updateChatPanel();
        break;
      }
      case "sendChatMessage": {
        const conversation = this.chatModel.conversations[message.data.index];
        conversation.addUserMessage({ content: message.data.message });
        await this.updateChatPanel();
        await conversation.answer();

        if (conversation instanceof GenerateTestConversationModel) {
          await conversation.updateEditor();
        }

        await this.updateChatPanel();
        break;
      }
      case "startChat": {
        await this.startChat();
        break;
      }
      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`unsupported type: ${exhaustiveCheck}`);
      }
    }
  }

  async startChat() {
    await this.addAndShowConversation(
      new FreeConversationModel(
        {
          id: this.nextChatId(),
          selectedText: this.getSelectedTextFromActiveEditor(),
        },
        { openAIClient: this.openAIClient }
      )
    );
  }

  async generateTest() {
    const input = this.getActiveEditorSelectionInput();

    if (input == null) {
      return;
    }

    const conversation = await this.addAndShowConversation(
      new GenerateTestConversationModel(
        {
          id: this.nextChatId(),
          filename: input.filename,
          range: input.range,
          selectedText: input.selectedText,
        },
        { openAIClient: this.openAIClient }
      )
    );

    await conversation.answer();
    await conversation.updateEditor();
    await this.updateChatPanel();
  }

  async explainCode() {
    const input = this.getActiveEditorSelectionInput();

    if (input == null) {
      return;
    }

    const conversation = await this.addAndShowConversation(
      new ExplainCodeConversationModel(
        {
          id: this.nextChatId(),
          filename: input.filename,
          range: input.range,
          selectedText: input.selectedText,
        },
        { openAIClient: this.openAIClient }
      )
    );

    await conversation.answer();
    await this.updateChatPanel();
  }
}
