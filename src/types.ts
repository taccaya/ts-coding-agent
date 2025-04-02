// src/types.ts

// 各ツールのパラメータインターフェース
export interface ListFileParams {
  path: string;
  recursive?: string; // オプショナル（XMLに存在しない場合があるため）
}

export interface ReadFileParams {
  path: string;
}

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface AskQuestionParams {
  question: string;
}

export interface ExecuteCommandParams {
  command: string;
  requires_approval?: string; // オプショナル
}

export interface CompleteParams {
  result: string;
}

// ツール実行結果のインターフェース
export interface ToolResponse {
  success: boolean;
  message: string;
}

// パースされたXMLツールの型
export type ParsedToolParams =
  | ListFileParams
  | ReadFileParams
  | WriteFileParams
  | AskQuestionParams
  | ExecuteCommandParams
  | CompleteParams;

// ツール関数の型シグネチャ
export type ToolFunction = (params: any) => Promise<ToolResponse>; // パラメータは実行時に型チェック

// Gemini APIの会話履歴の型 (参考: @google/generative-ai の型)
// import { Content } from "@google/generative-ai";
// export type GeminiMessage = Content;

// 今回はシンプルにするため独自の型定義
export interface ChatMessage {
    role: 'user' | 'model'; // Geminiでは'model' (OpenAIの'assistant'に相当)
    parts: { text: string }[];
}
