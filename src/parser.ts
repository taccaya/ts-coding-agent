// src/parser.ts
import { parseStringPromise } from 'xml2js';
import * as readline from 'readline/promises'; // readline.Interface 型のためにインポート
import {
    ToolResponse,
    ParsedToolParams // この型は params の型付けに使えるが、呼び出し時は any のまま
} from './types';
import {
    ToolType,
    listFile,
    readFile,
    writeFile,
    askQuestion,
    executeCommand,
    complete,
} from './tools';

// toolImplementations マップは使わない

const toolNameRegex = /<([a-z_]+)>/;

// 引数に rl: readline.Interface を追加
export async function parseAndExecuteTool(
    rl: readline.Interface, // ★ 追加
    llmResponse: string
): Promise<{ response: ToolResponse; toolType: string | null; isComplete: boolean }> {

    let cleanedResponse = ''; // エラーハンドリング用に try の外で定義

    try {
        // レスポンス文字列の前処理
        cleanedResponse = llmResponse
            .trim()
            .replace(/^```(?:xml)?\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();

        // console.log("Cleaned Response for Parsing:\n", cleanedResponse); // デバッグ用

        if (!cleanedResponse) {
             console.warn("LLM response was empty after cleaning:", llmResponse);
             return {
                response: { success: false, message: 'Cleaned response is empty.' },
                toolType: null,
                isComplete: false,
            };
        }

        // 1. どのツールか判定
        const match = cleanedResponse.match(toolNameRegex);
        if (!match || !match[1]) {
            console.warn("Cleaned response doesn't seem to contain a valid tool XML:", cleanedResponse);
            return {
                response: { success: false, message: 'No valid tool tag found in the cleaned response.' },
                toolType: null,
                isComplete: false,
            };
        }
        const toolType = match[1];

        // 2. XML全体をパースしてパラメータを取得
        const parsedXml = await parseStringPromise(cleanedResponse, {
            explicitArray: false,
            trim: true,
            tagNameProcessors: [key => key.toLowerCase()],
            attrNameProcessors: [key => key.toLowerCase()],
        });

        const params = parsedXml[toolType] || {};

        // 3. ツール関数を実行 (switch文で分岐し、必要な関数に rl を渡す)
        let toolResponse: ToolResponse;

        console.log(`\nExecuting Tool: ${toolType}`);
        if (Object.keys(params).length > 0) {
           console.log("Parameters:", params);
        }

        switch (toolType) {
            case ToolType.ListFile:
                toolResponse = await listFile(params); // rl 不要
                break;
            case ToolType.ReadFile:
                toolResponse = await readFile(params); // rl 不要
                break;
            case ToolType.WriteFile:
                toolResponse = await writeFile(rl, params); // ★ rl を渡す
                break;
            case ToolType.AskQuestion:
                toolResponse = await askQuestion(rl, params); // ★ rl を渡す
                break;
            case ToolType.ExecuteCommand:
                toolResponse = await executeCommand(rl, params); // ★ rl を渡す
                break;
            case ToolType.Complete:
                toolResponse = await complete(params); // rl 不要
                break;
            default:
                 // 未知のツールタイプの場合
                 console.error(`Unknown tool type encountered: ${toolType}`);
                 return {
                    response: { success: false, message: `Unknown tool type: ${toolType}` },
                    toolType: toolType,
                    isComplete: false,
                };
        }

        // 4. 結果を返す
        return {
            response: toolResponse,
            toolType: toolType,
            isComplete: toolType === ToolType.Complete,
        };

    } catch (error: any) {
        console.error("Error parsing or executing tool:", error);
        console.error("Original LLM Response was:", llmResponse); // エラー時の情報
        console.error("Cleaned Response before Error was:", cleanedResponse); // エラー時の情報
        return {
            response: { success: false, message: `Error processing tool response: ${error.message}` },
            toolType: null, // エラー時はツールタイプ不明
            isComplete: false,
        };
    }
}