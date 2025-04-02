// src/main.ts
import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Content, Part } from '@google/generative-ai';
import * as readline from 'readline/promises'; // readline をインポート
import { parseAndExecuteTool } from './parser';
// ToolType は parser から参照されるので直接の import は不要かも
// import { ToolType } from './tools';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable not set.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash", // または "gemini-1.5-pro-latest"
    // systemInstruction は startChat で設定
});

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const systemPrompt = `あなたはコーディングエージェントです。以下のツールを使ってタスクを完了してください：

# ListFile
ディレクトリ内のファイル一覧を取得します。
<list_file>
<path>ディレクトリのパス (デフォルトは .)</path>
<recursive>true または false (デフォルトは false)</recursive>
</list_file>

# ReadFile
ファイルの内容を読み取ります。
<read_file>
<path>ファイルのパス</path>
</read_file>

# WriteFile
ファイルに内容を書き込みます。新規ファイル作成も可能です。
<write_file>
<path>ファイルのパス</path>
<content>
書き込む内容
</content>
</write_file>

# AskQuestion
ユーザーに追加情報が必要な場合に質問します。
<ask_question>
<question>質問内容</question>
</ask_question>

# ExecuteCommand
シェルコマンドを実行します。危険なコマンドの可能性があるため、ユーザーの承認が必要か判断してください。
<execute_command>
<command>実行するコマンド</command>
<requires_approval>true または false (デフォルトは false)</requires_approval>
</execute_command>

# Complete
全てのタスクが完了した場合、このツールを呼び出して終了します。
<complete>
<result>タスクの結果や成果物の説明、最終的なメッセージ</result>
</complete>

あなたはユーザーのリクエストに応じて、上記のXML形式で定義されたツールの中から**必ず1つだけ**を選択して応答しなければなりません。
ツールを使わずに、通常の会話形式で応答してはいけません。
思考プロセスや次にどのツールを使うかの説明は不要です。XMLの応答のみを返してください。
実行環境は一般的なLinuxシェル環境を想定してください。`;


async function main() {
  console.log("コーディングエージェントへようこそ！");
  console.log("タスクを入力してください (例: '現在のディレクトリにhello.txtというファイルを作成し、Hello World!と書き込んでください'):");

  // readline インターフェースをここで一つだけ作成
  const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
  });

  // ★全体を try...finally で囲む
  try {
      // 最初のタスク入力を受け取る (作成した rl を使用)
      const userTask = await rl.question('Task: ');

      // デバッグやログ用に会話履歴を保持 (オプション)
      const chatHistoryLog: Content[] = [];

      // Geminiのチャットセッションを開始
      const chat = model.startChat({
          history: [], // セッション開始時の履歴は空
          safetySettings,
          systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      });

      let isComplete = false;
      const maxTurns = 15;
      let turns = 0;

      // 最初に送信するメッセージ
      let messageToSend: string | null = userTask;
      chatHistoryLog.push({ role: 'user', parts: [{ text: userTask }] });

      // メインループ
      while (!isComplete && turns < maxTurns && messageToSend !== null) {
          turns++;
          console.log(`\n--- Turn ${turns} ---`);

          try {
              console.log(`Sending message to Gemini: "${messageToSend}"`);
              const result = await chat.sendMessage(messageToSend);
              const response = result.response;
              const assistantResponseText = response.text();

              // レスポンス内容の検証
              if (!assistantResponseText) {
                  console.error("Error: Received empty response from Gemini.");
                  const finishReason = response.candidates?.[0]?.finishReason;
                  const safetyRatings = response.candidates?.[0]?.safetyRatings;
                  console.log("Finish Reason:", finishReason);
                  console.log("Safety Ratings:", safetyRatings);
                   if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'OTHER') {
                      console.error(`Execution stopped due to ${finishReason}.`);
                      break; // ループ中断
                  }
                  messageToSend = "[SYSTEM] Received empty response from model. Please check previous steps and try again, outputting a valid XML tool.";
                  chatHistoryLog.push({ role: 'model', parts: [{ text: "<error>Empty response</error>" }] });
                  chatHistoryLog.push({ role: 'user', parts: [{ text: messageToSend }] });
                  continue;
              }

              console.log("Gemini Raw Response:\n", assistantResponseText);
              chatHistoryLog.push({ role: 'model', parts: [{ text: assistantResponseText }] });

              // XMLをパースしてツールを実行 (rl を渡す)
              // ★ parseAndExecuteTool に rl を渡す
              const { response: toolResponse, toolType, isComplete: completed } = await parseAndExecuteTool(rl, assistantResponseText);

              console.log(`\n[Tool Result: ${toolType || 'N/A'}] Success: ${toolResponse.success}`);
              console.log(toolResponse.message);

              isComplete = completed;

              if (!isComplete) {
                  // 次の Gemini への入力としてツール結果を整形
                  const toolResultPrefix = toolType ? `[${toolType} Result]` : '[Execution Result]';
                  const resultStatus = toolResponse.success ? 'Success' : 'Failure';
                  messageToSend = `${toolResultPrefix} ${resultStatus}:\n${toolResponse.message}`;
                  chatHistoryLog.push({ role: 'user', parts: [{ text: messageToSend }] });
              } else {
                  messageToSend = null; // Complete の場合は次の送信はない
              }

          } catch (error: any) {
              console.error(`\n--- Error in Turn ${turns} ---`);
              console.error(error);
               if (error.message?.includes("SAFETY")) {
                   console.error("Execution stopped due to safety settings or other critical error.");
                   isComplete = true; // ループを終了させる
              } else {
                   const errorMessageForLLM = `[SYSTEM Error] An error occurred: ${error.message}. Please analyze the error and previous steps, then decide the next best tool to use or use the complete tool if the task is impossible.`;
                   messageToSend = errorMessageForLLM;
                   chatHistoryLog.push({ role: 'user', parts: [{ text: messageToSend }] });
              }
          }
      } // end while loop

      // --- ループ終了後の処理 ---
      if (turns >= maxTurns) {
        console.log("\n--- Reached maximum turns, stopping execution. ---");
      } else if (isComplete) {
          console.log("\n--- Task Completed ---");
      } else {
          console.log("\n--- Execution stopped unexpectedly. ---");
      }

  } finally {
      // ★ プログラム終了時に必ず readline インターフェースを閉じる
      console.log("\nClosing readline interface.");
      rl.close();
  }
}

// Unhandled Rejection の監視
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // エラー終了させるか、ログだけにするかは状況による
  // process.exit(1);
});

main().catch(error => {
    console.error("An error occurred during main execution:", error);
    process.exit(1); // main 関数自体でエラーが起きたら終了
});